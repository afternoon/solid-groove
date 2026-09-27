/**
 * Where an amp envelope's corners sit in its well (#447), and the way back
 * from a dragged corner to a time. Pure, so the drawing and the drag agree by
 * construction and a test can pin both.
 *
 * Coordinates are fractions of the well: `x` 0..1 left to right, `y` 0..1
 * bottom to top. Each stage's time takes a square-root share of at most
 * `STAGE_SHARE` of the width, so the short times people actually use (a few
 * milliseconds of attack) still get room, and attack, decay and release
 * together can never crowd the sustain hold off the well.
 */

export const STAGE_SHARE = 0.26;
/** The envelope's floor and peak, inset so a stroke on either is visible. */
export const FLOOR = 0.01;
export const PEAK = 0.97;

export interface EnvelopeTimes {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

export type EnvelopePoint = readonly [x: number, y: number];

/** The width one stage takes for `seconds`, out of a longest time of `max`. */
export function stageWidth(seconds: number, max: number): number {
  const t = Math.min(Math.max(seconds, 0), max);
  return max > 0 ? Math.sqrt(t / max) * STAGE_SHARE : 0;
}

/** The time a stage `width` wide stands for — `stageWidth` run backwards. */
export function stageSeconds(width: number, max: number): number {
  const share = Math.min(Math.max(width, 0), STAGE_SHARE) / STAGE_SHARE;
  return share * share * max;
}

/** The sustain level at height `y`. */
export function sustainAt(y: number): number {
  return Math.min(1, Math.max(0, (y - FLOOR) / (PEAK - FLOOR)));
}

/**
 * The envelope's outline: start, peak, end of decay, end of hold, end of
 * release. Points 1–3 are the three handles a person can drag.
 */
export function envelopePoints(times: EnvelopeTimes, max: number): EnvelopePoint[] {
  const attack = stageWidth(times.attack, max);
  const decay = stageWidth(times.decay, max);
  const release = stageWidth(times.release, max);
  const hold = FLOOR + (PEAK - FLOOR) * Math.min(1, Math.max(0, times.sustain));
  return [
    [0, FLOOR],
    [attack, PEAK],
    [attack + decay, hold],
    [1 - release, hold],
    [1, FLOOR],
  ];
}

/** The handle nearest `point`: 0 attack, 1 decay/sustain, 2 release/sustain. */
export function nearestHandle(points: readonly EnvelopePoint[], x: number, y: number) {
  const handles = [points[1], points[2], points[3]];
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  handles.forEach(([hx, hy], index) => {
    // Height counts half: the well is wider than it is tall.
    const distance = Math.hypot(hx - x, (hy - y) * 0.5);
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  });
  return nearest as 0 | 1 | 2;
}

/** SVG path data for `points` in a `width` × `height` box, `y` flipped down. */
export function svgPath(points: readonly EnvelopePoint[], width: number, height: number) {
  return points
    .map(
      ([x, y], i) =>
        `${i ? "L" : "M"}${(x * width).toFixed(1)},${((1 - y) * height).toFixed(1)}`,
    )
    .join(" ");
}
