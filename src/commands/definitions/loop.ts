import { z } from "zod";
import type { SongLoop } from "../../domain/entities";
import { barAlignedRange, ticksToBars } from "../../domain/time";
import { withSong } from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
} from "../types";

/**
 * The loop commands (LOOP-017).
 *
 * `song.loop` is project state, so the brace moves the same way everything else
 * in a project does: through a registered command, one revision and one history
 * entry per edit, invertible. Dragging the brace is a continuous gesture, so
 * the ruler wraps a drag in `history.beginGesture()` and the whole drag lands
 * as one undo step (#280).
 *
 * `loop.setRange` snaps to bars here rather than trusting its caller. The
 * domain invariant rejects an unaligned range instead of repairing it, so
 * something has to do the alignment, and doing it in the command means a
 * pointer drag, the keyboard, and the assistant all land on the same bar lines
 * from the same raw ticks.
 *
 * `loop.setEnabled` carries the state to set rather than being a toggle. A
 * toggle is not replayable — replaying it against a different starting state
 * lands on the opposite answer — and it cannot be inverted into itself
 * safely, so the surface that owns the button passes `!current` and the
 * command stays deterministic.
 */

export const loopSetRangePayloadSchema = z.strictObject({
  /** Raw ticks; snapped to bars by the command. */
  startTicks: z.int().min(0),
  endTicks: z.int().min(0),
});
export type LoopSetRangePayload = z.infer<typeof loopSetRangePayloadSchema>;

export const loopSetEnabledPayloadSchema = z.strictObject({
  enabled: z.boolean(),
});
export type LoopSetEnabledPayload = z.infer<typeof loopSetEnabledPayloadSchema>;

/** Bar numbers as a producer counts them: bar 1 is tick 0. */
function barLabel(ticks: number): number {
  return ticksToBars(ticks) + 1;
}

function withLoop(project: Parameters<typeof withSong>[0], loop: SongLoop) {
  return withSong(project, { ...project.song, loop });
}

export const loopSetRangeCommand = defineCommand<LoopSetRangePayload>({
  type: "loop.setRange",
  version: 1,
  schema: loopSetRangePayloadSchema,
  summarize(payload) {
    const range = barAlignedRange(payload.startTicks, payload.endTicks);
    return `Set loop to bars ${barLabel(range.startTicks)}-${barLabel(range.endTicks)}`;
  },
  apply(project, payload) {
    const range = barAlignedRange(payload.startTicks, payload.endTicks);
    return applied(withLoop(project, { ...project.song.loop, ...range }));
  },
  invert(_payload, before) {
    return [setLoopRange(before.song.loop.startTicks, before.song.loop.endTicks)];
  },
});

export const loopSetEnabledCommand = defineCommand<LoopSetEnabledPayload>({
  type: "loop.setEnabled",
  version: 1,
  schema: loopSetEnabledPayloadSchema,
  summarize: (payload) => (payload.enabled ? "Turn looping on" : "Turn looping off"),
  apply(project, payload) {
    return applied(withLoop(project, { ...project.song.loop, enabled: payload.enabled }));
  },
  invert(_payload, before) {
    return [setLoopEnabled(before.song.loop.enabled)];
  },
});

// --- Typed builders -------------------------------------------------------

export function setLoopRange(
  startTicks: number,
  endTicks: number,
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
