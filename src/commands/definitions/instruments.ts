import { z } from "zod";
import { type Instrument, instrumentSchema } from "../../domain/entities";
import {
  type AssetId,
  assetIdSchema,
  type TrackId,
  trackIdSchema,
} from "../../domain/ids";
import { findTrack, replaceTrack, trackLabel } from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
  rejected,
} from "../types";

/**
 * Instrument lifecycle commands (LOOP-004, PRD INS-01).
 *
 * A track's instrument is *structure*, not a per-value edit, so replacing it or
 * its sample is its own command rather than a `parameter.set`. Two guarantees
 * matter here and both fall out of the command kernel:
 *
 * - **Clip data survives.** Clips live outside the track (invariant 3): swapping
 *   a sampler for a synth, or one sample for another, only rewrites
 *   `track.instrument` and never touches a clip's notes. A note clip authored
 *   against one instrument replays against the next.
 * - **Undo restores exactly.** Each command's `invert` captures the previous
 *   instrument (or sample) verbatim, so redo/undo round-trips are byte-for-byte,
 *   including any parameters the replaced instrument carried.
 *
 * Sample *load* cancellation lives in the audio graph (`AudioBufferCache`
 * generation tracking): the command records intent, and reconciling the new
 * projection is what abandons the stale decode.
 */

export const instrumentChangePayloadSchema = z.strictObject({
  trackId: trackIdSchema,
  /** The instrument to install, or `null` to clear the track's instrument. */
  instrument: instrumentSchema.nullable(),
});
export type InstrumentChangePayload = z.infer<typeof instrumentChangePayloadSchema>;

export const instrumentSetSamplePayloadSchema = z.strictObject({
  trackId: trackIdSchema,
  /** The asset the sampler should play, or `null` to clear it. */
  assetId: assetIdSchema.nullable(),
});
export type InstrumentSetSamplePayload = z.infer<typeof instrumentSetSamplePayloadSchema>;

function describeInstrument(instrument: Instrument | null): string {
  if (!instrument) return "no instrument";
  switch (instrument.kind) {
    case "sampler":
      return "sampler";
    case "synth":
      return "synth";
    case "drumMachine":
      return "drum machine";
  }
}

export const instrumentChangeCommand = defineCommand<InstrumentChangePayload>({
  type: "instrument.change",
  version: 1,
  schema: instrumentChangePayloadSchema,
  summarize: (payload, project) =>
    `Change ${trackLabel(project, payload.trackId)} to ${describeInstrument(payload.instrument)}`,
  apply(project, payload) {
    const track = findTrack(project, payload.trackId);
    if (!track) {
      return rejected(`Track ${payload.trackId} does not exist`);
    }
    return applied(replaceTrack(project, { ...track, instrument: payload.instrument }));
  },
  invert(payload, before) {
    const track = findTrack(before, payload.trackId);
    return track ? [changeInstrument(payload.trackId, track.instrument)] : [];
  },
});

export const instrumentSetSampleCommand = defineCommand<InstrumentSetSamplePayload>({
  type: "instrument.setSample",
  version: 1,
  schema: instrumentSetSamplePayloadSchema,
  summarize: (payload, project) =>
    payload.assetId
      ? `Replace sample on ${trackLabel(project, payload.trackId)}`
      : `Clear sample on ${trackLabel(project, payload.trackId)}`,
  apply(project, payload) {
    const track = findTrack(project, payload.trackId);
    if (!track) {
      return rejected(`Track ${payload.trackId} does not exist`);
    }
    if (track.instrument?.kind !== "sampler") {
      return rejected(`Track ${track.id} has no sampler to load a sample into`);
    }
    return applied(
      replaceTrack(project, {
        ...track,
        // Only the asset changes: pitch, start/end, and envelope carry
        // through unchanged, which is the "compatible clip data preserved"
        // guarantee at the instrument level.
        instrument: { ...track.instrument, assetId: payload.assetId },
      }),
    );
  },
  invert(payload, before) {
    const track = findTrack(before, payload.trackId);
    if (track?.instrument?.kind !== "sampler") {
      return [];
    }
    return [setSample(payload.trackId, track.instrument.assetId)];
  },
});

// --- Typed builders -------------------------------------------------------

export function changeInstrument(
  trackId: TrackId,
  instrument: Instrument | null,
): CommandInput<InstrumentChangePayload> {
  return {
    type: instrumentChangeCommand.type,
    payload: { trackId, instrument },
  };
}

export function setSample(
  trackId: TrackId,
  assetId: AssetId | null,
): CommandInput<InstrumentSetSamplePayload> {
  return {
    type: instrumentSetSampleCommand.type,
    payload: { trackId, assetId },
  };
}

/** Registered, payload-erased commands from this module. */
export const instrumentCommands: readonly RegisteredCommand[] = [
  eraseCommand(instrumentChangeCommand),
  eraseCommand(instrumentSetSampleCommand),
];
