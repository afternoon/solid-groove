import type { Analytics } from "../analytics/analytics";
import { barAlignedLoop } from "../audio/Transport";
import {
  type RawCommandInput,
  setLoopEnabled,
  setLoopRange,
  type TransactionResult,
} from "../commands";
import type { Project } from "../domain/entities";
import { TICKS_PER_BAR, toTicks } from "../domain/time";

/**
 * The editor's two loop actions (PRD AUD-02, LOOP-017): toggle looping, and
 * set the loop range. Each is one user action, so each dispatches exactly one
 * command and logs exactly one analytics event, and only when the command
 * committed.
 *
 * The loop is song state: neither action touches the transport. The transport
 * follows because `useProjectAudio` mirrors `song.loop` onto it on every
 * project change, the same way it mirrors tempo. The ruler brace drags its own
 * gesture (`loopBrace.ts`); the header's loop button and `Shift+L` call
 * `toggleLooping`, and `L` calls `loopSelection`.
 */
export interface LoopActionContext {
  project(): Project | null;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  readonly analytics: Analytics;
}

/** Flip whether the transport obeys the song's loop range. */
export function toggleLooping(context: LoopActionContext): boolean {
  const project = context.project();
  if (!project) return false;
  const enabled = !project.song.loop.enabled;
  const result = context.dispatch(setLoopEnabled(enabled));
  if (!result?.ok) return false;
  context.analytics.log("loop_toggled", { enabled });
  return true;
}

/**
 * `L` with clips selected: loop exactly their span (rounded out to whole bars)
 * and turn looping on, as one transaction — so one undo step, and one event per
 * thing that actually changed. Already looping over that range is a no-op.
 */
export function loopSelection(
  context: LoopActionContext,
  startTicks: number,
  endTicks: number,
): boolean {
  const project = context.project();
  if (!project) return false;
  const range = barAlignedLoop(startTicks, endTicks);
  const current = project.song.loop;
  const rangeChanged =
    range.startTicks !== current.startTicks || range.endTicks !== current.endTicks;
  if (!rangeChanged && current.enabled) return false;
  const commands = [
    ...(rangeChanged
      ? [setLoopRange(toTicks(range.startTicks), toTicks(range.endTicks))]
      : []),
    ...(current.enabled ? [] : [setLoopEnabled(true)]),
  ];
  const result = context.dispatch(commands);
  if (!result?.ok) return false;
  if (rangeChanged) {
    context.analytics.log("loop_range_set", {
      bar_count: (range.endTicks - range.startTicks) / TICKS_PER_BAR,
    });
  }
  if (!current.enabled) context.analytics.log("loop_toggled", { enabled: true });
  return true;
}
