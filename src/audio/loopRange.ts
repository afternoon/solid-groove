import { TICKS_PER_BAR } from "../domain/time";

/**
 * The transport's loop range arithmetic (PRD AUD-02), kept apart from
 * `Transport.ts` because it has no Tone in it: a surface that only needs to
 * snap a range to bars — the arrangement's loop brace — can import this
 * without constructing an audio context. `Transport.ts` re-exports all of it,
 * so every existing import is unchanged.
 */

/** A bar-aligned loop range, in absolute ticks. */
export interface LoopRange {
  readonly startTicks: number;
  readonly endTicks: number;
}

/** The song's loop as the transport mirrors it: the range and the toggle. */
export interface SongLoopState extends LoopRange {
  readonly enabled: boolean;
}

/**
 * Snaps an arbitrary loop range to whole bars (PRD AUD-02: "an arrangement
 * loop range aligned to bars"). The start rounds down and the end rounds up to
 * the nearest bar, and an empty or inverted range is widened to at least one
 * bar so the loop always encloses real musical time.
 */
export function barAlignedLoop(startTicks: number, endTicks: number): LoopRange {
  const rawStart = Math.max(0, Math.min(startTicks, endTicks));
  const rawEnd = Math.max(startTicks, endTicks);
  const start = Math.floor(rawStart / TICKS_PER_BAR) * TICKS_PER_BAR;
  let end = Math.ceil(rawEnd / TICKS_PER_BAR) * TICKS_PER_BAR;
  if (end <= start) end = start + TICKS_PER_BAR;
  return { startTicks: start, endTicks: end };
}

/** A loop spanning `barCount` bars from bar `startBar` (both zero-based). */
export function loopOfBars(startBar: number, barCount: number): LoopRange {
  const start = Math.max(0, Math.floor(startBar)) * TICKS_PER_BAR;
  const bars = Math.max(1, Math.floor(barCount));
  return { startTicks: start, endTicks: start + bars * TICKS_PER_BAR };
}
