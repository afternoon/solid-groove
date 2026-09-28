/**
 * What the shaping and space devices do to a sound, as curves for their wells
 * (#447). Each mirrors its engine in `src/audio/devices` — the same transfer
 * functions, gains and size scaling — so the drawing is the sound's shape, not
 * an illustration. They are written out here because the engine's own copies
 * live inside Tone node factories the editor cannot import.
 */

/** A Web Audio waveshaper holds its input to -1..1 before the curve. */
const shaped = (curve: (x: number) => number, x: number) =>
  curve(Math.max(-1, Math.min(1, x)));

const overdriveCurve = (x: number) => Math.tanh(3 * (x < 0 ? 1.4 : 1) * x) / Math.tanh(3);
const softCurve = (x: number) => Math.tanh(2 * x) / Math.tanh(2);
const foldCurve = (x: number) => Math.sin(Math.PI * Math.max(-1.5, Math.min(1.5, x)));

/** Overdrive output for input `x` at `drive` (0..1): gain in, part given back. */
export function overdriveTransfer(drive: number, x: number): number {
  const gain = 1 + drive ** 2 * 39;
  return gain ** -0.5 * shaped(overdriveCurve, gain * x);
}

/** Saturator output for input `x`: `driveDb` in, `character` soft → fold. */
export function saturatorTransfer(driveDb: number, character: number, x: number): number {
  const into = 10 ** (driveDb / 20) * x;
  const out =
    (1 - character) * shaped(softCurve, into) + character * shaped(foldCurve, into);
  return 10 ** (-driveDb / 40) * out;
}

/** SVG path of `transfer` over -1..1 in a `width` × `height` box, clamped. */
export function transferPath(
  transfer: (x: number) => number,
  width: number,
  height: number,
): string {
  const steps = 120;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 2 - 1;
    const y = Math.max(-1, Math.min(1, transfer(x)));
    points.push(
      `${i ? "L" : "M"}${((i / steps) * width).toFixed(1)},${(((1 - y) / 2) * height).toFixed(1)}`,
    );
  }
  return points.join(" ");
}

/** How long a reverb's tail is shown for, in seconds. */
export const REVERB_WINDOW = 8;

/** The pre-delay and decay the reverb engine actually uses (size scales both). */
export function reverbTiming(decay: number, size: number, predelay: number) {
  return {
    predelay: predelay + size * 0.05,
    decay: Math.max(0.001, decay * (0.5 + size)),
  };
}

/**
 * The tail's level as an SVG area, in decibels so a 60 dB fall reads as the
 * straight ramp it is: silence through the pre-delay, full level, then down to
 * the floor at the end of the decay.
 */
export function reverbTailPath(
  decay: number,
  size: number,
  predelay: number,
  width: number,
  height: number,
): string {
  const timing = reverbTiming(decay, size, predelay);
  const x = (t: number) =>
    ((Math.min(t, REVERB_WINDOW) / REVERB_WINDOW) * width).toFixed(1);
  const end = timing.predelay + timing.decay;
  // Past the window the ramp is cut where it leaves, at the level it has then.
  const exitLevel =
    end > REVERB_WINDOW ? 1 - (REVERB_WINDOW - timing.predelay) / timing.decay : 0;
  const top = (height * 0.05).toFixed(1);
  return [
    `M${x(timing.predelay)},${height}`,
    `L${x(timing.predelay)},${top}`,
    `L${x(end)},${(height - Math.max(0, exitLevel) * height * 0.95).toFixed(1)}`,
    `L${x(end)},${height} Z`,
  ].join(" ");
}
