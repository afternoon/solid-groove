/**
 * The loop brace on the arrangement's ruler (`LOOP-018`; PRD AUD-02).
 *
 * Framework-free, like `placementEditingController.ts` beside it. The brace is
 * the song's own loop (`song.loop`, LOOP-017), so this module holds no range of
 * its own: it hit-tests the ruler against the song's range, turns a pointer
 * drag into bar-aligned ranges, and applies them through one
 * `history.beginGesture()` per drag — every step lands immediately, so the
 * canvas and the transport follow the pointer, and the whole drag commits as
 * one history entry and one revision.
 *
 * It never moves the brace on its own: a range only changes because a drag or
 * a keyboard control asked for it.
 */

import type { Analytics } from "../analytics/analytics";
import { barAlignedLoop, type LoopRange } from "../audio/loopRange";
import { setLoopRange } from "../commands/definitions/loop";
import type { RawCommandInput } from "../commands/types";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { ticksToPixels, type Viewport } from "./geometry";
import { describeSpan } from "./selectionAnnouncement";

/** Which part of the brace a pointer grabbed: an edge resizes, the middle moves. */
export type LoopBraceHandle = "start" | "end" | "body";

/** How close, in CSS pixels, a pointer has to be to an edge to grab it. */
export const LOOP_HANDLE_HIT_PX = 6;

/**
 * The wording of a loop range: the arrangement's one bar-counting rule
 * (`describeSpan`, #292), so a brace over the first bar alone reads "bar 1"
 * and one over bars 1 and 2 reads "bars 1 to 2", exactly as a selection over
 * the same bars does. The accessible mirror on the arrangement is the single
 * place this text is shown.
 */
export function describeLoopBars(range: LoopRange): string {
  return describeSpan(range.startTicks, range.endTicks);
}

/**
 * The part of the brace under a viewport-local x, or null when the pointer is
 * clear of it. An edge wins over the middle within `LOOP_HANDLE_HIT_PX`, and
 * the nearer edge wins when a narrow brace puts the pointer near both.
 */
export function hitTestLoopBrace(
  range: LoopRange,
  localX: number,
  viewport: Pick<Viewport, "pixelsPerTick" | "scrollLeft">,
): LoopBraceHandle | null {
  const left = ticksToPixels(range.startTicks, viewport) - viewport.scrollLeft;
  const right = ticksToPixels(range.endTicks, viewport) - viewport.scrollLeft;
  const toLeft = Math.abs(localX - left);
  const toRight = Math.abs(localX - right);
  if (Math.min(toLeft, toRight) <= LOOP_HANDLE_HIT_PX) {
    return toRight <= toLeft ? "end" : "start";
  }
  return localX > left && localX < right ? "body" : null;
}

/** The bar line nearest a tick, never before the top of the song. */
function nearestBarLine(ticks: number): number {
  return Math.max(0, Math.round(ticks / TICKS_PER_BAR) * TICKS_PER_BAR);
}

/**
 * Where a drag puts the brace. Each edge snaps to the nearest bar line and
 * stops a bar short of the other, and the middle moves the whole range by
 * whole bars without changing its length — so the result is never empty or
 * inverted. `barAlignedLoop` has the last word on the range either way.
 */
export function draggedLoopRange(
  origin: LoopRange,
  handle: LoopBraceHandle,
  grabTicks: number,
  pointerTicks: number,
): LoopRange {
  const { startTicks, endTicks } = origin;
  if (handle === "end") {
    return barAlignedLoop(
      startTicks,
      Math.max(nearestBarLine(pointerTicks), startTicks + TICKS_PER_BAR),
    );
  }
  if (handle === "start") {
    return barAlignedLoop(
      Math.min(nearestBarLine(pointerTicks), endTicks - TICKS_PER_BAR),
      endTicks,
    );
  }
  const start = nearestBarLine(startTicks + pointerTicks - grabTicks);
  return barAlignedLoop(start, start + (endTicks - startTicks));
}

/** A continuous gesture, as `history.beginGesture()` hands one out. */
export interface LoopBraceGesture {
  apply(commands: RawCommandInput): void;
  commit(summary?: string): void;
  cancel(): void;
}

export interface LoopBraceDragOptions {
  /** The song's loop range as it stands right now. */
  readonly getLoop: () => LoopRange | null;
  readonly beginGesture: (summary: string) => LoopBraceGesture | undefined;
  readonly analytics: Analytics;
}

interface DragState {
  readonly origin: LoopRange;
  readonly handle: LoopBraceHandle;
  readonly grabTicks: number;
  readonly gesture: LoopBraceGesture;
  current: LoopRange;
}

const sameRange = (a: LoopRange, b: LoopRange): boolean =>
  a.startTicks === b.startTicks && a.endTicks === b.endTicks;

/**
 * One brace drag at a time. `loop_range_set` fires once, when a drag that
 * changed the range commits — never per pointer move, and not at all for a
 * drag that ends where it began (which cancels, leaving no history entry).
 */
export function createLoopBraceDrag(options: LoopBraceDragOptions) {
  let drag: DragState | null = null;

  function begin(handle: LoopBraceHandle, pointerTicks: number): boolean {
    const origin = options.getLoop();
    if (drag || !origin) return false;
    const gesture = options.beginGesture(handle === "body" ? "Move loop" : "Resize loop");
    if (!gesture) return false;
    drag = { origin, handle, grabTicks: pointerTicks, gesture, current: origin };
    return true;
  }

  /** One step of the drag, applied live so the ruler and transport follow. */
  function update(pointerTicks: number): void {
    if (!drag) return;
    const next = draggedLoopRange(drag.origin, drag.handle, drag.grabTicks, pointerTicks);
    if (sameRange(next, drag.current)) return;
    drag.gesture.apply(setLoopRange(toTicks(next.startTicks), toTicks(next.endTicks)));
    drag.current = next;
  }

  /** Ends the drag: one history entry if the range moved, none if it did not. */
  function end(): void {
    if (!drag) return;
    const { gesture, origin, current } = drag;
    drag = null;
    if (sameRange(origin, current)) {
      gesture.cancel();
      return;
    }
    gesture.commit();
    options.analytics.log("loop_range_set", {
      bar_count: (current.endTicks - current.startTicks) / TICKS_PER_BAR,
    });
  }

  /** Abandons the drag and puts the brace back where it started. */
  function cancel(): void {
    if (!drag) return;
    drag.gesture.cancel();
    drag = null;
  }

  return { begin, update, end, cancel, isDragging: () => drag !== null };
}

export type LoopBraceDrag = ReturnType<typeof createLoopBraceDrag>;
