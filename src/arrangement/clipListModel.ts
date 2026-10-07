/**
 * The arrangement's clips as a list (#76): the keyboard and screen-reader twin
 * of the canvas, where a pointer picks a clip by where it is drawn.
 *
 * Pure, like `selectionAnnouncement.ts`: `ClipList.tsx` renders the entries
 * as a listbox and asks `stepClip` which clip an arrow key lands on. The order
 * is the canvas's reading order, track by track from the top and left to right
 * along each, so Down walks the arrangement the way an eye does.
 */

import type { PlacementId } from "../domain/ids";
import type { ArrangementProjection } from "./projection";
import { describeSpan } from "./selectionAnnouncement";

export interface ClipListEntry {
  readonly id: PlacementId;
  /** What the option says: "Kick on BD, bars 1 to 2". */
  readonly label: string;
}

/** Every clip in the arrangement, track by track and left to right. */
export function clipListEntries(projection: ArrangementProjection): ClipListEntry[] {
  return projection.tracks.flatMap((track) =>
    (projection.placementsByTrack.get(track.id)?.items ?? []).map((placement) => ({
      id: placement.id,
      label: `${placement.label} on ${track.name}, ${describeSpan(
        placement.startTicks,
        placement.endTicks,
      )}`,
    })),
  );
}

/**
 * The clip one step `by` from `from` in `order`. From no clip (or one no longer
 * listed) Down starts at the first and Up at the last, as a listbox does; at
 * either end it stays put rather than wrapping. Null only for an empty list.
 */
export function stepClip(
  order: readonly PlacementId[],
  from: PlacementId | null,
  by: -1 | 1,
): PlacementId | null {
  if (order.length === 0) return null;
  const index = from === null ? -1 : order.indexOf(from);
  if (index === -1) return (by > 0 ? order[0] : order[order.length - 1]) ?? null;
  return order[Math.min(order.length - 1, Math.max(0, index + by))] ?? null;
}

export interface ScrollBox {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The scroll that brings a box (content pixels: `left`/`right` along the
 * timeline, `top`/`bottom` down the rows) into view, moving as little as it
 * can. A box wider or taller than the view is aligned by its start, where the
 * clip begins.
 */
export function revealScroll(
  view: ScrollBox,
  box: { left: number; right: number; top: number; bottom: number },
): { scrollLeft: number; scrollTop: number } {
  const along = (scroll: number, size: number, start: number, end: number): number => {
    if (start < scroll || end - start > size) return start;
    if (end > scroll + size) return end - size;
    return scroll;
  };
  return {
    scrollLeft: Math.max(0, along(view.scrollLeft, view.width, box.left, box.right)),
    scrollTop: Math.max(0, along(view.scrollTop, view.height, box.top, box.bottom)),
  };
}
