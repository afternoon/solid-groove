// Pixel geometry for the piano roll (ARR-010): a fixed 1/16 grid of 40 x 30 px
// cells at 100%, where zoom widens or narrows steps and never touches rows.
//
// Pure and framework-free. Positions here are *content* pixels, measured from
// the top-left of the grid itself; the component converts a pointer's client
// position into them from the grid's live bounding box, which already folds
// in the scroll offset.

import { TICKS_PER_SIXTEENTH } from "../../domain/time";

/** A step's width at 100% zoom. */
export const STEP_WIDTH = 40;
/** Every row's height, at every zoom. */
export const ROW_HEIGHT = 30;
/** The gap between cells, drawn as the grid's lines. */
export const CELL_GAP = 2;
/** Time-only zoom range and the toolbar buttons' factor. */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_FACTOR = 1.25;
/** A press that moves less than this is a click. */
export const DRAG_THRESHOLD = 4;
/** How close to a note's end a press resizes it rather than moves it. */
const EDGE_GRAB = 10;
/**
 * How far inside the roll's edge auto-scroll begins. Narrower than half a row,
 * so the middle of any cell fully in view never scrolls the roll by itself:
 * only a pointer pressed against an edge, or past it, does.
 */
export const AUTO_SCROLL_EDGE = 12;
/** How far past the edge the speed keeps growing, so it tops out. */
const AUTO_SCROLL_REACH = 36;

/** A step's width at `zoom`. */
export function stepWidth(zoom: number): number {
  return Math.round(STEP_WIDTH * clampZoom(zoom));
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Ticks to (possibly fractional) steps, and back. */
export function ticksToSteps(ticks: number): number {
  return ticks / TICKS_PER_SIXTEENTH;
}
export function stepsToTicks(steps: number): number {
  return Math.round(steps * TICKS_PER_SIXTEENTH);
}

/** The step under content-x, which may be outside the clip. */
export function stepAt(x: number, zoom: number): number {
  return Math.floor(x / stepWidth(zoom));
}

/** The row index under content-y. */
export function rowAt(y: number): number {
  return Math.floor(y / ROW_HEIGHT);
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where a note sits: its start and length in ticks, on a row. The cell gap is
 * taken off its far edges so neighbouring notes read as separate, and a very
 * short note keeps a few pixels to click.
 */
export function noteBox(
  startTicks: number,
  durationTicks: number,
  row: number,
  zoom: number,
): Box {
  const width = stepWidth(zoom);
  return {
    left: ticksToSteps(startTicks) * width,
    top: row * ROW_HEIGHT,
    width: Math.max(4, ticksToSteps(durationTicks) * width - CELL_GAP),
    height: ROW_HEIGHT - CELL_GAP,
  };
}

export type NoteGrab = "start" | "end" | "body";

/**
 * Which part of a note a press at `offset` (pixels from the note's left edge)
 * takes: either end resizes, the middle moves. The ends are at most 10 px and
 * never more than a third of the note, so a short note can still be moved.
 */
export function grabAt(offset: number, width: number): NoteGrab {
  const edge = Math.min(EDGE_GRAB, width / 3);
  if (offset < edge) return "start";
  if (width - offset < edge) return "end";
  return "body";
}

/** Whether a press has travelled far enough to be a drag. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/** A rectangle from two corners, whichever way the lasso was drawn. */
export function rectFrom(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

/** Whether a box and a rectangle overlap. A zero-height lasso still touches. */
export function touches(
  box: Box,
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    box.left <= rect.right &&
    box.left + box.width >= rect.left &&
    box.top <= rect.bottom &&
    box.top + box.height >= rect.top
  );
}

/**
 * The scroll offset that keeps the step under `anchor` (pixels from the
 * visible grid's left edge) in place when zoom changes, so zooming happens
 * around the pointer rather than the start of the clip.
 */
export function scrollForZoom(
  scrollLeft: number,
  anchor: number,
  fromZoom: number,
  toZoom: number,
): number {
  const step = (scrollLeft + anchor) / stepWidth(fromZoom);
  return Math.max(0, step * stepWidth(toZoom) - anchor);
}

/**
 * How far to auto-scroll this frame for a pointer at `position` along an axis
 * whose visible span is `start..end`: nothing well inside it, and faster the
 * closer the pointer gets to (or the further past) either edge.
 */
export function autoScrollSpeed(position: number, start: number, end: number): number {
  const edge = AUTO_SCROLL_EDGE;
  let depth = 0;
  if (position < start + edge) depth = position - (start + edge);
  else if (position > end - edge) depth = position - (end - edge);
  const limited = Math.max(-AUTO_SCROLL_REACH, Math.min(AUTO_SCROLL_REACH, depth));
  return limited / 2;
}
