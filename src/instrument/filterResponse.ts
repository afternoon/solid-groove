/**
 * A resonant biquad's magnitude response, for drawing it in a well (#447), and
 * the log frequency axis the well and its drag share. The audio engine runs
 * the filter itself; this only has to look like what it hears: the same
 * second-order low-, high- or band-pass shape at the same cutoff and Q.
 */

export type FilterShape = "lowpass" | "highpass" | "bandpass";

export const LOWEST_HZ = 20;
export const HIGHEST_HZ = 20_000;
/** The dB range drawn, top to bottom. */
export const TOP_DB = 26;
export const BOTTOM_DB = -36;

/** Frequency at `x` (0..1) along a log axis from 20 Hz to 20 kHz. */
export function frequencyAt(x: number): number {
  return LOWEST_HZ * (HIGHEST_HZ / LOWEST_HZ) ** Math.min(1, Math.max(0, x));
}

/** Where `hz` sits along that axis. */
export function positionOf(hz: number): number {
  return Math.log(hz / LOWEST_HZ) / Math.log(HIGHEST_HZ / LOWEST_HZ);
}

/** Gain in dB at `hz` for a filter at `cutoff` with quality `q`. */
export function responseDb(shape: FilterShape, hz: number, cutoff: number, q: number) {
  const r = hz / cutoff;
  // A Q of zero has no response to draw; the audio floors it the same way.
  const quality = Math.max(q, 0.1);
  const denominator = Math.sqrt((1 - r * r) ** 2 + (r / quality) ** 2);
  const magnitude =
    shape === "lowpass"
      ? 1 / denominator
      : shape === "highpass"
        ? (r * r) / denominator
        : r / quality / denominator;
  return 20 * Math.log10(Math.max(magnitude, 1e-6));
}

/** SVG path data for the response across a `width` × `height` box. */
export function responsePath(
  shape: FilterShape,
  cutoff: number,
  q: number,
  width: number,
  height: number,
): string {
  const steps = 90;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const db = Math.min(
      TOP_DB,
      Math.max(BOTTOM_DB, responseDb(shape, frequencyAt(i / steps), cutoff, q)),
    );
    const y = ((TOP_DB - db) / (TOP_DB - BOTTOM_DB)) * height;
    points.push(`${i ? "L" : "M"}${((i / steps) * width).toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}
