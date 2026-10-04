import { z } from "zod";
import type { Project } from "../../domain/entities";
import {
  type AutomationLane,
  automationLaneSchema,
  type ReturnBus,
  returnBusSchema,
  type Send,
  sendSchema,
} from "../../domain/entities";
import {
  type ReturnId,
  returnIdSchema,
  type TrackId,
  trackIdSchema,
} from "../../domain/ids";
import { MAX_RETURN_BUSES } from "../../domain/parse";
import {
  CONTROL_PARTS,
  controlAddress,
  SONG_ENTITY,
  sendControl,
} from "../controlAddress";
import {
  byOrder,
  findTrack,
  quoted,
  renumber,
  trackLabel,
  withSong,
} from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
  rejected,
} from "../types";

/**
 * Return-bus and send structure (PRD FX-02, LOOP-021).
 *
 * A return bus is a shared effects chain that tracks feed through their sends.
 * These commands create, rename and remove a return, and add or remove one
 * track's send to it. Level and pan are not here: they are `parameter.set`'s
 * `send` and `return` scopes, and a return's chain is the `device.*` commands'
 * `return` chain.
 *
 * Deleting a return cascades to everything that cannot outlive it — every
 * track's send to it, and every automation lane on the return or on a send to
 * it — because leaving one behind is a dangling reference `parseProject`
 * rejects. `return.create` therefore accepts those companions, so the inverse
 * of a delete restores the whole bus and its routing in one atomic command.
 * `send.remove` and `send.add` relate the same way for a send's automation.
 */

/** One track's send to a return, and where in its `sendConfig` it sits. */
export const placedSendSchema = z.strictObject({
  trackId: trackIdSchema,
  send: sendSchema,
  index: z.int().min(0),
});
export type PlacedSend = z.infer<typeof placedSendSchema>;

export const returnCreatePayloadSchema = z.strictObject({
  returnBus: returnBusSchema,
  sends: z.array(placedSendSchema).default([]),
  automation: z.array(automationLaneSchema).default([]),
});
export type ReturnCreatePayload = z.infer<typeof returnCreatePayloadSchema>;

export const returnDeletePayloadSchema = z.strictObject({
  returnId: returnIdSchema,
});
export type ReturnDeletePayload = z.infer<typeof returnDeletePayloadSchema>;

export const returnChangesSchema = z
  .strictObject({
    name: returnBusSchema.shape.name.optional(),
  })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
    message: "An update must change at least one field",
  });
export type ReturnChanges = z.infer<typeof returnChangesSchema>;

export const returnUpdatePayloadSchema = z.strictObject({
  returnId: returnIdSchema,
  changes: returnChangesSchema,
});
export type ReturnUpdatePayload = z.infer<typeof returnUpdatePayloadSchema>;

export const sendAddPayloadSchema = z.strictObject({
  trackId: trackIdSchema,
  send: sendSchema,
  /** Where in the track's sends it goes; the end when omitted. */
  index: z.int().min(0).optional(),
  /** Automation lanes on this send, restored with it by an undo. */
  automation: z.array(automationLaneSchema).default([]),
});
export type SendAddPayload = z.infer<typeof sendAddPayloadSchema>;

export const sendRemovePayloadSchema = z.strictObject({
  trackId: trackIdSchema,
  returnId: returnIdSchema,
});
export type SendRemovePayload = z.infer<typeof sendRemovePayloadSchema>;

// --- Helpers --------------------------------------------------------------

export function findReturn(project: Project, returnId: ReturnId): ReturnBus | undefined {
  return project.song.returns.find((bus) => bus.id === returnId);
}

/** A return's name for a summary line, falling back to its ID once deleted. */
export function returnLabel(project: Project, returnId: ReturnId): string {
  return quoted(findReturn(project, returnId)?.name ?? returnId);
}

/** Does this lane automate the return itself, or any track's send to it? */
function targetsReturn(lane: AutomationLane, returnId: ReturnId): boolean {
  const { target } = lane;
  return (
    (target.scope === "return" || target.scope === "send") && target.returnId === returnId
  );
}

/** Does this lane automate one track's send to one return? */
function targetsSend(
  lane: AutomationLane,
  trackId: TrackId,
  returnId: ReturnId,
): boolean {
  const { target } = lane;
  return (
    target.scope === "send" && target.trackId === trackId && target.returnId === returnId
  );
}

/** `items` with `item` inserted at `index`, or at the end past it. */
function insertAt<T>(items: readonly T[], index: number | undefined, item: T): T[] {
  const at = index === undefined ? items.length : Math.min(index, items.length);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/** Every track's send to `returnId`, with where it sits, in track order. */
function sendsTo(project: Project, returnId: ReturnId): PlacedSend[] {
  const placed: PlacedSend[] = [];
  for (const track of project.song.tracks) {
    const index = track.sendConfig.findIndex((send) => send.returnId === returnId);
    if (index >= 0)
      placed.push({ trackId: track.id, send: track.sendConfig[index], index });
  }
  return placed;
}

/**
 * Adds sends to the tracks they name. Fails with a message if a track is gone
 * or already sends to that return; tracks no send names keep their identity.
 */
function withSends(
  project: Project,
  sends: readonly PlacedSend[],
): { project: Project } | { error: string } {
  const byTrack = new Map<TrackId, PlacedSend[]>();
  for (const placed of sends) {
    byTrack.set(placed.trackId, [...(byTrack.get(placed.trackId) ?? []), placed]);
  }
  for (const trackId of byTrack.keys()) {
    if (!findTrack(project, trackId)) return { error: `Track ${trackId} does not exist` };
  }
  const tracks = project.song.tracks.map((track) => {
    const added = byTrack.get(track.id);
    if (!added) return track;
    let sendConfig: Send[] = [...track.sendConfig];
    for (const placed of [...added].sort((a, b) => a.index - b.index)) {
      sendConfig = insertAt(sendConfig, placed.index, placed.send);
    }
    return { ...track, sendConfig };
  });
  for (const track of tracks) {
    const seen = new Set<string>();
    for (const send of track.sendConfig) {
      if (seen.has(send.returnId)) {
        return {
          error: `Track ${track.id} already sends to return bus ${send.returnId}`,
        };
      }
      seen.add(send.returnId);
    }
  }
  return { project: withSong(project, { ...project.song, tracks }) };
}

// --- Commands -------------------------------------------------------------

export const returnCreateCommand = defineCommand<ReturnCreatePayload>({
  type: "return.create",
  version: 1,
  schema: returnCreatePayloadSchema,
  summarize: (payload) =>
    payload.sends.length > 0 || payload.returnBus.devices.length > 0
      ? `Restore return ${quoted(payload.returnBus.name)}`
      : `Add return ${quoted(payload.returnBus.name)}`,
  apply(project, payload) {
    const bus = payload.returnBus;
    if (findReturn(project, bus.id)) {
      return rejected(`Return bus ${bus.id} already exists`);
    }
    const sorted = byOrder(project.song.returns);
    if (sorted.length >= MAX_RETURN_BUSES) {
      return rejected(`A song may have at most ${MAX_RETURN_BUSES} return buses`);
    }
    if (bus.order > sorted.length) {
      return rejected(
        `Cannot insert a return bus at position ${bus.order} of ${sorted.length}`,
      );
    }
    const foreignSend = payload.sends.find((placed) => placed.send.returnId !== bus.id);
    if (foreignSend) {
      return rejected(
        `Track ${foreignSend.trackId}'s send targets ${foreignSend.send.returnId}, not ${bus.id}`,
      );
    }
    const foreignLane = payload.automation.find((lane) => !targetsReturn(lane, bus.id));
    if (foreignLane) {
      return rejected(
        `Automation ${foreignLane.id} does not target return bus ${bus.id}`,
      );
    }
    const routed = withSends(project, payload.sends);
    if ("error" in routed) return rejected(routed.error);
    const next = routed.project;
    return applied(
      withSong(next, {
        ...next.song,
        returns: renumber([
          ...sorted.slice(0, bus.order),
          bus,
          ...sorted.slice(bus.order),
        ]),
        automation: [...next.song.automation, ...payload.automation],
      }),
    );
  },
  invert: (payload) => [removeReturn(payload.returnBus.id)],
  touches: (payload) => [controlAddress(payload.returnBus.id, CONTROL_PARTS.header)],
});

export const returnDeleteCommand = defineCommand<ReturnDeletePayload>({
  type: "return.delete",
  version: 1,
  schema: returnDeletePayloadSchema,
  summarize: (payload, project) =>
    `Delete return ${returnLabel(project, payload.returnId)}`,
  apply(project, payload) {
    const bus = findReturn(project, payload.returnId);
    if (!bus) {
      return rejected(`Return bus ${payload.returnId} does not exist`);
    }
    return applied(
      withSong(project, {
        ...project.song,
        returns: renumber(
          byOrder(project.song.returns).filter((candidate) => candidate.id !== bus.id),
        ),
        // A track with no send to the bus keeps its object (structural sharing).
        tracks: project.song.tracks.map((track) =>
          track.sendConfig.some((send) => send.returnId === bus.id)
            ? {
                ...track,
                sendConfig: track.sendConfig.filter((send) => send.returnId !== bus.id),
              }
            : track,
        ),
        automation: project.song.automation.filter(
          (lane) => !targetsReturn(lane, bus.id),
        ),
      }),
    );
  },
  invert(payload, before) {
    const bus = findReturn(before, payload.returnId);
    if (!bus) return [];
    return [
      addReturn(bus, {
        sends: sendsTo(before, bus.id),
        automation: before.song.automation.filter((lane) => targetsReturn(lane, bus.id)),
      }),
    ];
  },
  touches: () => [controlAddress(SONG_ENTITY, CONTROL_PARTS.returns)],
});

export const returnUpdateCommand = defineCommand<ReturnUpdatePayload>({
  type: "return.update",
  version: 1,
  schema: returnUpdatePayloadSchema,
  summarize: (payload, project) =>
    `Rename return ${returnLabel(project, payload.returnId)} to ${quoted(payload.changes.name ?? "")}`,
  apply(project, payload) {
    const bus = findReturn(project, payload.returnId);
    if (!bus) {
      return rejected(`Return bus ${payload.returnId} does not exist`);
    }
    const next: ReturnBus = {
      ...bus,
      ...(payload.changes.name !== undefined ? { name: payload.changes.name } : {}),
    };
    return applied(
      withSong(project, {
        ...project.song,
        returns: project.song.returns.map((candidate) =>
          candidate.id === bus.id ? next : candidate,
        ),
      }),
    );
  },
  invert(payload, before) {
    const bus = findReturn(before, payload.returnId);
    if (!bus) return [];
    return [
      updateReturn(payload.returnId, {
        ...(payload.changes.name !== undefined ? { name: bus.name } : {}),
      }),
    ];
  },
  touches: (payload) => [controlAddress(payload.returnId, CONTROL_PARTS.name)],
});

export const sendAddCommand = defineCommand<SendAddPayload>({
  type: "send.add",
  version: 1,
  schema: sendAddPayloadSchema,
  summarize: (payload, project) =>
    `Send track ${trackLabel(project, payload.trackId)} to return ${returnLabel(project, payload.send.returnId)}`,
  apply(project, payload) {
    const { trackId, send } = payload;
    if (!findReturn(project, send.returnId)) {
      return rejected(`Return bus ${send.returnId} does not exist`);
    }
    const foreignLane = payload.automation.find(
      (lane) => !targetsSend(lane, trackId, send.returnId),
    );
    if (foreignLane) {
      return rejected(
        `Automation ${foreignLane.id} does not target track ${trackId}'s send to ${send.returnId}`,
      );
    }
    const routed = withSends(project, [
      { trackId, send, index: payload.index ?? Number.MAX_SAFE_INTEGER },
    ]);
    if ("error" in routed) return rejected(routed.error);
    const next = routed.project;
    return applied(
      withSong(next, {
        ...next.song,
        automation: [...next.song.automation, ...payload.automation],
      }),
    );
  },
  invert: (payload) => [removeSend(payload.trackId, payload.send.returnId)],
  touches: (payload) => [sendControl(payload.trackId, payload.send.returnId)],
});

export const sendRemoveCommand = defineCommand<SendRemovePayload>({
  type: "send.remove",
  version: 1,
  schema: sendRemovePayloadSchema,
  summarize: (payload, project) =>
    `Remove the send from track ${trackLabel(project, payload.trackId)} to return ${returnLabel(project, payload.returnId)}`,
  apply(project, payload) {
    const track = findTrack(project, payload.trackId);
    if (!track) {
      return rejected(`Track ${payload.trackId} does not exist`);
    }
    if (!track.sendConfig.some((send) => send.returnId === payload.returnId)) {
      return rejected(`Track ${track.id} has no send to return bus ${payload.returnId}`);
    }
    return applied(
      withSong(project, {
        ...project.song,
        tracks: project.song.tracks.map((candidate) =>
          candidate.id === track.id
            ? {
                ...track,
                sendConfig: track.sendConfig.filter(
                  (send) => send.returnId !== payload.returnId,
                ),
              }
            : candidate,
        ),
        automation: project.song.automation.filter(
          (lane) => !targetsSend(lane, track.id, payload.returnId),
        ),
      }),
    );
  },
  invert(payload, before) {
    const track = findTrack(before, payload.trackId);
    const index =
      track?.sendConfig.findIndex((send) => send.returnId === payload.returnId) ?? -1;
    if (!track || index < 0) return [];
    return [
      addSend(track.id, track.sendConfig[index], {
        index,
        automation: before.song.automation.filter((lane) =>
          targetsSend(lane, track.id, payload.returnId),
        ),
      }),
    ];
  },
  touches: (payload) => [controlAddress(payload.trackId, CONTROL_PARTS.sends)],
});

// --- Typed builders -------------------------------------------------------

export function addReturn(
  returnBus: ReturnBus,
  restore: {
    sends?: readonly PlacedSend[];
    automation?: readonly AutomationLane[];
  } = {},
): CommandInput<ReturnCreatePayload> {
  return {
    type: returnCreateCommand.type,
    payload: {
      returnBus,
      sends: [...(restore.sends ?? [])],
      automation: [...(restore.automation ?? [])],
    },
  };
}

export function removeReturn(returnId: ReturnId): CommandInput<ReturnDeletePayload> {
  return { type: returnDeleteCommand.type, payload: { returnId } };
}

export function updateReturn(
  returnId: ReturnId,
  changes: ReturnChanges,
): CommandInput<ReturnUpdatePayload> {
  return { type: returnUpdateCommand.type, payload: { returnId, changes } };
}

export function addSend(
  trackId: TrackId,
  send: Send,
  restore: { index?: number; automation?: readonly AutomationLane[] } = {},
): CommandInput<SendAddPayload> {
  return {
    type: sendAddCommand.type,
    payload: {
      trackId,
      send,
      ...(restore.index !== undefined ? { index: restore.index } : {}),
      automation: [...(restore.automation ?? [])],
    },
  };
}

export function removeSend(
  trackId: TrackId,
  returnId: ReturnId,
): CommandInput<SendRemovePayload> {
  return { type: sendRemoveCommand.type, payload: { trackId, returnId } };
}

/** Registered, payload-erased commands from this module. */
export const returnCommands: readonly RegisteredCommand[] = [
  eraseCommand(returnCreateCommand),
  eraseCommand(returnDeleteCommand),
  eraseCommand(returnUpdateCommand),
  eraseCommand(sendAddCommand),
  eraseCommand(sendRemoveCommand),
];
