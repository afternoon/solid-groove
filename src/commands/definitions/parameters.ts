import { z } from "zod";
import type { Project } from "../../domain/entities";
import { deviceIdSchema, returnIdSchema, trackIdSchema } from "../../domain/ids";
import {
  coerceParameterValue,
  getParameterDefinition,
  MASTER_VOLUME,
  type ParameterDefinition,
  RETURN_PAN,
  RETURN_VOLUME,
  SONG_TEMPO,
  TRACK_PAN,
  TRACK_SEND_LEVEL,
  TRACK_VOLUME,
} from "../../domain/parameters";
import { findTrack, replaceTrack, withSong } from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
  rejected,
} from "../types";

/**
 * One generic parameter command for every user-controlled numeric value
 * (PRD invariants 4 and 10).
 *
 * The command never repeats a range, a default, or a clamping rule: it looks
 * the target's definition up in `src/domain/parameters.ts` and applies that
 * definition's policy. Adding a device parameter in Alpha Milestone 1 therefore makes it
 * settable by the UI, the keyboard, and the assistant without a new command.
 */

export const parameterTargetSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("song"),
    parameterId: z.string().min(1),
  }),
  z.strictObject({
    scope: z.literal("track"),
    trackId: trackIdSchema,
    parameterId: z.string().min(1),
  }),
  z.strictObject({
    scope: z.literal("instrument"),
    trackId: trackIdSchema,
    parameterId: z.string().min(1),
  }),
  z.strictObject({
    scope: z.literal("trackDevice"),
    trackId: trackIdSchema,
    deviceId: deviceIdSchema,
    parameterId: z.string().min(1),
  }),
  z.strictObject({
    scope: z.literal("send"),
    trackId: trackIdSchema,
    returnId: returnIdSchema,
    parameterId: z.string().min(1),
  }),
  z.strictObject({
    scope: z.literal("return"),
    returnId: returnIdSchema,
    parameterId: z.string().min(1),
  }),
  z.strictObject({
    scope: z.literal("master"),
    parameterId: z.string().min(1),
  }),
]);
export type ParameterTarget = z.infer<typeof parameterTargetSchema>;

export const parameterSetPayloadSchema = z.strictObject({
  target: parameterTargetSchema,
  value: z.number(),
});
export type ParameterSetPayload = z.infer<typeof parameterSetPayloadSchema>;

interface ResolvedParameter {
  readonly definition: ParameterDefinition;
  readonly current: number;
  write(value: number): Project;
}

type Resolution = ResolvedParameter | { readonly error: string };

function isUnresolved(resolution: Resolution): resolution is { readonly error: string } {
  return "error" in resolution;
}

/**
 * Maps a target onto its parameter definition and the single place in the
 * project that stores its value.
 */
function resolveParameter(project: Project, target: ParameterTarget): Resolution {
  switch (target.scope) {
    case "song":
      return expectParameter(target.parameterId, [SONG_TEMPO], (definition) => ({
        definition,
        current: project.song.tempo,
        write: (value) => withSong(project, { ...project.song, tempo: value }),
      }));
    case "master":
      return expectParameter(target.parameterId, [MASTER_VOLUME], (definition) => ({
        definition,
        current: project.song.master.volume,
        write: (value) =>
          withSong(project, {
            ...project.song,
            master: { ...project.song.master, volume: value },
          }),
      }));
    case "track": {
      const track = findTrack(project, target.trackId);
      if (!track) {
        return { error: `Track ${target.trackId} does not exist` };
      }
      return expectParameter(
        target.parameterId,
        [TRACK_VOLUME, TRACK_PAN],
        (definition) => ({
          definition,
          current: definition === TRACK_VOLUME ? track.mixer.volume : track.mixer.pan,
          write: (value) =>
            replaceTrack(project, {
              ...track,
              mixer: {
                ...track.mixer,
                [definition === TRACK_VOLUME ? "volume" : "pan"]: value,
              },
            }),
        }),
      );
    }
    case "instrument": {
      const track = findTrack(project, target.trackId);
      if (!track) {
        return { error: `Track ${target.trackId} does not exist` };
      }
      const instrument = track.instrument;
      if (!instrument) {
        return { error: `Track ${track.id} has no instrument` };
      }
      // Instrument parameters are namespaced by instrument kind, matching how
      // the domain validates a stored instrument parameter value.
      const definition = getParameterDefinition(
        `${instrument.kind}.${target.parameterId}`,
      );
      if (!definition) {
        return {
          error: `Instrument ${instrument.kind} has no registered parameter "${target.parameterId}"`,
        };
      }
      return {
        definition,
        current: instrument.parameters[target.parameterId] ?? definition.defaultValue,
        write: (value) =>
          replaceTrack(project, {
            ...track,
            instrument: {
              ...instrument,
              parameters: {
                ...instrument.parameters,
                [target.parameterId]: value,
              },
            },
          }),
      };
    }
    case "send": {
      const track = findTrack(project, target.trackId);
      if (!track) {
        return { error: `Track ${target.trackId} does not exist` };
      }
      const send = track.sendConfig.find(
        (candidate) => candidate.returnId === target.returnId,
      );
      if (!send) {
        return {
          error: `Track ${track.id} has no send to return bus ${target.returnId}`,
        };
      }
      return expectParameter(target.parameterId, [TRACK_SEND_LEVEL], (definition) => ({
        definition,
        current: send.level,
        write: (value) =>
          replaceTrack(project, {
            ...track,
            sendConfig: track.sendConfig.map((candidate) =>
              candidate.returnId === send.returnId
                ? { ...candidate, level: value }
                : candidate,
            ),
          }),
      }));
    }
    case "return": {
      const bus = project.song.returns.find(
        (candidate) => candidate.id === target.returnId,
      );
      if (!bus) {
        return { error: `Return bus ${target.returnId} does not exist` };
      }
      return expectParameter(
        target.parameterId,
        [RETURN_VOLUME, RETURN_PAN],
        (definition) => ({
          definition,
          current: definition === RETURN_VOLUME ? bus.mixer.volume : bus.mixer.pan,
          write: (value) =>
            withSong(project, {
              ...project.song,
              returns: project.song.returns.map((candidate) =>
                candidate.id === bus.id
                  ? {
                      ...candidate,
                      mixer: {
                        ...candidate.mixer,
                        [definition === RETURN_VOLUME ? "volume" : "pan"]: value,
                      },
                    }
                  : candidate,
              ),
            }),
        }),
      );
    }
    case "trackDevice": {
      const track = findTrack(project, target.trackId);
      if (!track) {
        return { error: `Track ${target.trackId} does not exist` };
      }
      const device = track.devices.find((candidate) => candidate.id === target.deviceId);
      if (!device) {
        return {
          error: `Track ${track.id} has no device ${target.deviceId}`,
        };
      }
      // Device parameters are namespaced by device type, matching how the
      // domain validates a stored device parameter value.
      const definition = getParameterDefinition(`${device.type}.${target.parameterId}`);
      if (!definition) {
        return {
          error: `Device ${device.type} has no registered parameter "${target.parameterId}"`,
        };
      }
      return {
        definition,
        current: device.parameters[target.parameterId] ?? definition.defaultValue,
        write: (value) =>
          replaceTrack(project, {
            ...track,
            devices: track.devices.map((candidate) =>
              candidate.id === device.id
                ? {
                    ...candidate,
                    parameters: {
                      ...candidate.parameters,
                      [target.parameterId]: value,
                    },
                  }
                : candidate,
            ),
          }),
      };
    }
  }
}

/** Accepts only the parameters that this scope actually owns. */
function expectParameter(
  parameterId: string,
  allowed: readonly ParameterDefinition[],
  build: (definition: ParameterDefinition) => ResolvedParameter,
): Resolution {
  const definition = allowed.find((candidate) => candidate.id === parameterId);
  if (!definition) {
    return {
      error: `"${parameterId}" is not a parameter of this target (expected ${allowed
        .map((candidate) => `"${candidate.id}"`)
        .join(" or ")})`,
    };
  }
  return build(definition);
}

const UNIT_SUFFIX: Record<ParameterDefinition["unit"], string> = {
  bars: " bars",
  bpm: " BPM",
  decibels: " dB",
  hertz: " Hz",
  seconds: " s",
  semitones: " semitones",
  normalized: "",
  bipolar: "",
};

/** Human-readable value for a summary line, in the parameter's own unit. */
export function formatParameterValue(
  definition: ParameterDefinition,
  value: number,
): string {
  return `${Number(value.toFixed(4))}${UNIT_SUFFIX[definition.unit]}`;
}

export const parameterSetCommand = defineCommand<ParameterSetPayload>({
  type: "parameter.set",
  version: 1,
  schema: parameterSetPayloadSchema,
  summarize(payload, project) {
    const resolution = resolveParameter(project, payload.target);
    if (isUnresolved(resolution)) {
      return `Set ${payload.target.parameterId}`;
    }
    return `Set ${resolution.definition.label} to ${formatParameterValue(resolution.definition, payload.value)}`;
  },
  apply(project, payload) {
    const resolution = resolveParameter(project, payload.target);
    if (isUnresolved(resolution)) {
      return rejected(resolution.error);
    }
    const coerced = coerceParameterValue(resolution.definition, payload.value);
    if (!coerced.ok) {
      return rejected(coerced.reason);
    }
    return applied(resolution.write(coerced.value));
  },
  invert(payload, before) {
    const resolution = resolveParameter(before, payload.target);
    return isUnresolved(resolution)
      ? []
      : [setParameter(payload.target, resolution.current)];
  },
});

// --- Typed builders -------------------------------------------------------

export function setParameter(
  target: ParameterTarget,
  value: number,
): CommandInput<ParameterSetPayload> {
  return { type: parameterSetCommand.type, payload: { target, value } };
}

/** Registered, payload-erased commands from this module. */
export const parameterCommands: readonly RegisteredCommand[] = [
  eraseCommand(parameterSetCommand),
];
