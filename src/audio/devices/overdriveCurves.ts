/**
 * The Overdrive's transfer curve and drive law, kept free of Tone so the
 * engine (`distortion.ts`) and the editor's drawing of it (`deviceDrawings.ts`)
 * read the very same functions rather than two copies that can drift.
 *
 * The curve has a slope of exactly 1 at 0 on both halves, so at Drive 0 a
 * normal-level signal leaves the device at the level it arrived (#925). Any
 * change in level is the drive and its compensation, never a hidden gain in
 * the curve itself.
 */

/**
 * How far past full scale the curve is defined, as a linear factor: 4 is
 * +12 dB. A `WaveShaperNode` only reads its table over -1..1 and holds the end
 * values beyond it, so a table built over -1..1 brick-walls everything above
 * 0 dBFS. Building the table over -4..4 and scaling the signal into it by 1/4
 * leaves the knee, not the table's edge, to do the limiting (as the
 * Saturator does, #885).
 */
export const OVERDRIVE_HEADROOM = 4;

/**
 * How much harder the negative half is driven than the positive. Dividing it
 * back out keeps that half's slope at 1 too, so the asymmetry only shows up
 * where it should: the negative half bends sooner and tops out lower (at
 * 1/1.4), which gives the curve its even harmonics and valve-ish character
 * instead of the symmetric buzz a plain `Math.tanh` produces.
 */
const NEGATIVE_ASYMMETRY = 1.4;

/** The asymmetric clipping curve: unity at low level, easing towards +1 / -1/1.4. */
export const overdriveCurve = (x: number): number =>
  x < 0 ? Math.tanh(NEGATIVE_ASYMMETRY * x) / NEGATIVE_ASYMMETRY : Math.tanh(x);

/**
 * The gain into the curve for `drive` (0..1): 1x at 0, clean apart from the
 * knee rounding anything near full scale, up to 120x (+42 dB) at 1, hard,
 * obviously destructive clipping. Squared so the control's lower half is the
 * usable coloration range rather than all the audible change happening in the
 * first tenth of the travel.
 */
export function overdriveGain(drive: number): number {
  return 1 + drive ** 2 * 119;
}

/**
 * The gain after the curve: partial compensation (the inverse square root of
 * the drive gain), enough that drive is not a disguised volume control, not so
 * much that saturation stops reading as loud. 1 at Drive 0.
 */
export function overdriveMakeup(drive: number): number {
  return overdriveGain(drive) ** -0.5;
}

/**
 * The Overdrive's output for input `x` (linear) at `drive` (0..1), before its
 * tone filter, including the curve table's hold beyond
 * {@link OVERDRIVE_HEADROOM}.
 */
export function overdriveTransfer(drive: number, x: number): number {
  const into = Math.max(
    -OVERDRIVE_HEADROOM,
    Math.min(OVERDRIVE_HEADROOM, overdriveGain(drive) * x),
  );
  return overdriveMakeup(drive) * overdriveCurve(into);
}
