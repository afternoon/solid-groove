import { z } from "zod";
import { CLIP_LENGTH } from "./parameters";
import { TICKS_PER_BAR, type Ticks, toTicks } from "./time";

/**
 * The clip-length bound, in the two units the rest of the app needs it.
 *
 * `CLIP_LENGTH` (`src/domain/parameters.ts`) is where the range is declared;
 * everything here derives from it, so the domain schema, the step editor's bar
 * control, and `notes.duplicate`'s auto-extend cannot drift apart. The bound
 * belongs to clip length alone — `durationTickSchema` stays unbounded because
 * note, placement, and section durations share it and are not capped at 32
 * bars.
 */

export const MIN_CLIP_LENGTH_BARS = CLIP_LENGTH.min;
export const MAX_CLIP_LENGTH_BARS = CLIP_LENGTH.max;
export const MAX_CLIP_LENGTH_TICKS = MAX_CLIP_LENGTH_BARS * TICKS_PER_BAR;

/**
 * The clip lengths a user can choose, in bars. Doubling lengths are what fit
 * musically and keep the control a short list rather than a 32-item dropdown,
 * so an auto-extend rounds up to one of these rather than to any whole bar.
 */
export const CLIP_LENGTH_BARS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** A clip length: positive, and no longer than the maximum. */
export const clipLengthTickSchema = z
  .int()
  .min(1)
  .max(MAX_CLIP_LENGTH_TICKS)
  .brand<"ticks">();

/**
 * The shortest listed clip length that holds `minimumTicks`, or `null` when
 * that is past the maximum.
 */
export function nextClipLengthTicks(minimumTicks: number): Ticks | null {
  for (const bars of CLIP_LENGTH_BARS) {
    const ticks = bars * TICKS_PER_BAR;
    if (ticks >= minimumTicks) {
      return toTicks(ticks);
    }
  }
  return null;
}
