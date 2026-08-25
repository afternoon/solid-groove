/**
 * Renderer-agnostic viewport and row geometry (PRD section 9.3, "Viewport and
 * scrolling model" and "Culling, projection, and caches").
 *
 * Everything here is a pure function over plain data: no DOM, no Canvas, no
 * SolidJS. That is deliberate — this is the retained contract the FND-008
 * spike's disposable Canvas UI sits on top of, and the same contract a
 * production renderer (`ARR-005`) can keep using without the spike's UI code.
 */

/** Uniform per-row sizing. Rows are the same height today; the prefix-sum
 * helpers below do not assume that and keep working if rows vary later. */
export interface RowMetrics {
  /** Height in CSS pixels of one track's canvas row. */
  readonly trackHeightPx: number;
  /** Height in CSS pixels of one DOM track header. Should equal
   * `trackHeightPx` so the virtualized header column and the canvas rows
   * line up pixel-for-pixel. */
  readonly headerHeightPx: number;
}

export interface Viewport {
  /** Horizontal scroll offset in CSS pixels. */
  readonly scrollLeft: number;
  /** Vertical scroll offset in CSS pixels. */
  readonly scrollTop: number;
  /** Viewport width in CSS pixels. */
  readonly width: number;
  /** Viewport height in CSS pixels. */
  readonly height: number;
  /** CSS pixels per musical tick. Zoom is a change to this value alone —
   * it never changes canvas backing-store size on its own. */
  readonly pixelsPerTick: number;
}

export interface TickRange {
  readonly startTick: number;
  readonly endTick: number;
}

export interface RowRange {
  readonly startRow: number;
  readonly endRow: number;
}

/** Musical tick -> viewport-local CSS pixel (not yet scroll-adjusted). */
export function ticksToPixels(
  ticks: number,
  viewport: Pick<Viewport, "pixelsPerTick">,
): number {
  return ticks * viewport.pixelsPerTick;
}

/** Viewport-local CSS pixel (not scroll-adjusted) -> musical tick. */
export function pixelsToTicks(
  pixels: number,
  viewport: Pick<Viewport, "pixelsPerTick">,
): number {
  return pixels / viewport.pixelsPerTick;
}

/**
 * The tick range currently visible, expanded by `overscanPx` on each side so
 * culling can keep a small buffer of off-screen content ready without
 * scanning the whole arrangement.
 */
export function visibleTickRange(viewport: Viewport, overscanPx = 0): TickRange {
  const startTick = pixelsToTicks(
    Math.max(0, viewport.scrollLeft - overscanPx),
    viewport,
  );
  const endTick = pixelsToTicks(
    viewport.scrollLeft + viewport.width + overscanPx,
    viewport,
  );
  return {
    startTick: Math.max(0, Math.floor(startTick)),
    endTick: Math.ceil(endTick),
  };
}

/**
 * Cumulative row-top offsets in CSS pixels: `offsets[i]` is the top of row
 * `i`, and `offsets[rowCount]` is the total content height. Building this
 * once per row-count/metrics change lets both the header column and the
 * canvas find the visible row range with a binary search instead of a linear
 * scan, even once tracks can have per-row heights.
 */
export function buildRowOffsets(rowCount: number, rowMetrics: RowMetrics): number[] {
  const offsets = new Array<number>(rowCount + 1);
  offsets[0] = 0;
  for (let index = 0; index < rowCount; index += 1) {
    offsets[index + 1] = offsets[index] + rowMetrics.trackHeightPx;
  }
  return offsets;
}

/**
 * The row index whose span `[offsets[i], offsets[i + 1])` contains `y`.
 * Returns `-1` for a `y` above the first row and `rowCount` (one past the
 * last valid index) for a `y` at or below the last row's bottom edge, so
 * callers can clamp deliberately rather than by accident.
 */
export function rowIndexAtOffset(rowOffsets: readonly number[], y: number): number {
  const rowCount = rowOffsets.length - 1;
  if (rowCount <= 0) return -1;
  if (y < rowOffsets[0]) return -1;
  if (y >= rowOffsets[rowCount]) return rowCount;
  let low = 0;
  let high = rowCount - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (rowOffsets[mid] <= y) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/** The visible row range, expanded by `overscanRows` and clamped to valid indices. */
export function visibleRowRange(
  rowOffsets: readonly number[],
  viewport: Pick<Viewport, "scrollTop" | "height">,
  overscanRows = 0,
): RowRange {
  const rowCount = rowOffsets.length - 1;
  if (rowCount <= 0) return { startRow: 0, endRow: -1 };
  const firstRow = rowIndexAtOffset(rowOffsets, viewport.scrollTop);
  const lastRow = rowIndexAtOffset(rowOffsets, viewport.scrollTop + viewport.height);
  const clampedFirstRow = Math.min(Math.max(firstRow, 0), rowCount - 1);
  const clampedLastRow = Math.min(Math.max(lastRow, 0), rowCount - 1);
  // Overscan is clamped again after being applied: expanding the range must
  // never produce an index outside `[0, rowCount)`, which callers rely on
  // treating `endRow` as a directly indexable row.
  const startRow = Math.max(0, clampedFirstRow - overscanRows);
  const endRow = Math.min(rowCount - 1, clampedLastRow + overscanRows);
  return { startRow, endRow };
}

export interface ZoomAnchorInput {
  readonly viewport: Viewport;
  /** The pixels-per-tick value to zoom to. Callers clamp this to whatever
   * min/max zoom the UI allows before calling. */
  readonly nextPixelsPerTick: number;
  /** Viewport-local x (e.g. pointer position) that must stay under the
   * same musical tick after the zoom. */
  readonly anchorX: number;
}

/**
 * Zoom is "a change to the musical-time transform anchored under the
 * pointer, selection, or playhead" (PRD 9.3): the tick under `anchorX` before
 * the zoom must still be under `anchorX` after it, so scrolling never jumps
 * on the user mid-gesture.
 */
export function zoomAtAnchor(
  input: ZoomAnchorInput,
): Pick<Viewport, "pixelsPerTick" | "scrollLeft"> {
  const { viewport, nextPixelsPerTick, anchorX } = input;
  const anchorTick = pixelsToTicks(viewport.scrollLeft + anchorX, viewport);
  const nextScrollLeft = anchorTick * nextPixelsPerTick - anchorX;
  return {
    pixelsPerTick: nextPixelsPerTick,
    scrollLeft: Math.max(0, nextScrollLeft),
  };
}
