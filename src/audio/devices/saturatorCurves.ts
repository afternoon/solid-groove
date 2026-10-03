/**
 * The Saturator's transfer curves, kept free of Tone so the engine
 * (`distortion.ts`) and the editor's drawing of it (`deviceDrawings.ts`) read
 * the very same functions rather than two copies that can drift.
 *
 * Both curves have a slope of exactly 1 at 0, so at Drive 0 dB a normal-level
 * signal leaves the device at the level it arrived (#885). Any change in level
 * is the drive and its compensation, never a hidden gain in the curve itself.
 */

/**
 * How far past full scale the curves are defined, as a linear factor: 4 is
 * +12 dB. A `WaveShaperNode` only reads its table over -1..1 and holds the end
 * values beyond it, so a table built over -1..1 brick-walls everything above
 * 0 dBFS. Building the table over -4..4 and scaling the signal into it by 1/4
 * leaves the knee, not the table's edge, to do the limiting.
 */
export const SATURATOR_HEADROOM = 4;

/** Tape-style soft knee: unity at low level, easing smoothly towards ±1. */
export const saturatorSoftCurve = (x: number): number => Math.tanh(x);

/**
 * Sine wavefolder: unity at low level, peaking at ±1 just past full scale
 * (+3.9 dB) and folding back on itself above that, so a hot signal turns over
 * into obvious, bounded destruction instead of dropping out.
 */
export const saturatorFoldCurve = (x: number): number => Math.sin(x);

/**
 * The Saturator's output for input `x` (linear) at `driveDb` and `character`
 * (soft 0 → fold 1), including the drive's half-in-decibels compensation and
 * the curve table's hold beyond {@link SATURATOR_HEADROOM}.
 */
export function saturatorTransfer(driveDb: number, character: number, x: number): number {
  const into = Math.max(
    -SATURATOR_HEADROOM,
    Math.min(SATURATOR_HEADROOM, 10 ** (driveDb / 20) * x),
  );
  const out =
    (1 - character) * saturatorSoftCurve(into) + character * saturatorFoldCurve(into);
  return 10 ** (-driveDb / 40) * out;
}
