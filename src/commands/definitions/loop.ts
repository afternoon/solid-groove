import { z } from "zod";
import type { Project, SongLoop } from "../../domain/entities";
import { TICKS_PER_BAR, type Ticks, tickSchema } from "../../domain/time";
import { withSong } from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
} from "../types";

/**
 * Loop commands (PRD AUD-02, LOOP-017).
 *
 * The loop range and the loop toggle are song state (`song.loop`), so they
 * change only through these two commands: one revision and one history entry
 * each, with an exact inverse. The transport mirrors whatever the song says;
 * it never owns a loop of its own.
 *
 * `loop.setRange` does not snap. Bar-aligning a dragged range is the caller's
 * job (`barAlignedLoop`), and a range that is off a bar line, empty, or
 * inverted fails the domain invariant, so the transaction rolls back rather
 * than persisting a repaired guess. Toggling is `loop.setEnabled` with an
 * explicit value rather than a flip, so replay, redo and an assistant preview
 * all land on the same state whatever the project held before.
 */

export const loopSetRangePayloadSchema = z.strictObject({
  startTicks: tickSchema,
  endTicks: tickSchema,
});
export type LoopSetRangePayload = z.infer<typeof loopSetRangePayloadSchema>;

export const loopSetEnabledPayloadSchema = z.strictObject({
  enabled: z.boolean(),
});
export type LoopSetEnabledPayload = z.infer<typeof loopSetEnabledPayloadSchema>;

function withLoop(project: Project, loop: SongLoop): Project {
  return withSong(project, { ...project.song, loop });
}

/** "bars 3-4" for a range, 1-based and inclusive, as a person counts bars. */
function describeBars(startTicks: number, endTicks: number): string {
  const first = Math.floor(startTicks / TICKS_PER_BAR) + 1;
  const last = Math.ceil(endTicks / TICKS_PER_BAR);
  return first === last ? `bar ${first}` : `bars ${first}-${last}`;
}

export const loopSetRangeCommand = defineCommand<LoopSetRangePayload>({
  type: "loop.setRange",
  version: 1,
  schema: loopSetRangePayloadSchema,
  summarize: (payload) => `Loop ${describeBars(payload.startTicks, payload.endTicks)}`,
  apply(project, payload) {
    return applied(
      withLoop(project, {
        ...project.song.loop,
        startTicks: payload.startTicks,
        endTicks: payload.endTicks,
      }),
    );
  },
  invert: (_payload, before) => [
    setLoopRange(before.song.loop.startTicks, before.song.loop.endTicks),
  ],
});

export const loopSetEnabledCommand = defineCommand<LoopSetEnabledPayload>({
  type: "loop.setEnabled",
  version: 1,
  schema: loopSetEnabledPayloadSchema,
  summarize: (payload) => (payload.enabled ? "Turn looping on" : "Turn looping off"),
  apply(project, payload) {
    return applied(withLoop(project, { ...project.song.loop, enabled: payload.enabled }));
  },
  invert: (_payload, before) => [setLoopEnabled(before.song.loop.enabled)],
});

// --- Typed builders -------------------------------------------------------

export function setLoopRange(
  startTicks: Ticks,
  endTicks: Ticks,
): CommandInput<LoopSetRangePayload> {
  return { type: loopSetRangeCommand.type, payload: { startTicks, endTicks } };
}

export function setLoopEnabled(enabled: boolean): CommandInput<LoopSetEnabledPayload> {
  return { type: loopSetEnabledCommand.type, payload: { enabled } };
}

/** Registered, payload-erased commands from this module. */
export const loopCommands: readonly RegisteredCommand[] = [
  eraseCommand(loopSetRangeCommand),
  eraseCommand(loopSetEnabledCommand),
];
