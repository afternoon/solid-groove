/**
 * Loudness in LUFS, as ITU-R BS.1770-4 / EBU R 128 define it (#937): the pure
 * arithmetic behind the Limiter's short-term and integrated readouts, with no
 * Web Audio import so it is testable on its own. `loudnessMeter.ts` feeds it
 * from the graph.
 *
 * The signal is K-weighted (a high shelf for the head's acoustic effect, then
 * a high-pass that ignores rumble), squared and averaged per channel, and the
 * channels' mean squares summed: `L = -0.691 + 10·log10(Σ z)`. The -0.691 is
 * the K-weighting's gain at 1 kHz, so a 0 dBFS 1 kHz sine in both channels of
 * a stereo signal reads 0 LUFS.
 */

/** One biquad stage: feedforward `b` and feedback `a` (with `a[0]` = 1). */
export interface BiquadCoefficients {
  readonly b: readonly [number, number, number];
  readonly a: readonly [number, number, number];
}

/**
 * The two K-weighting stages for `sampleRate`. BS.1770 tabulates them only at
 * 48 kHz; these are the analogue prototypes behind that table (as libebur128
 * and pyloudnorm derive them), bilinear-transformed at any rate, and they
 * reproduce the table at 48 kHz.
 */
export function kWeighting(
  sampleRate: number,
): readonly [BiquadCoefficients, BiquadCoefficients] {
  // Stage 1: the high shelf, +4 dB above about 1.7 kHz.
  const shelfGainDb = 3.999843853973347;
  const shelfHz = 1681.974450955533;
  const shelfQ = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * shelfHz) / sampleRate);
  const vh = 10 ** (shelfGainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k1 / shelfQ + k1 * k1;
  const shelf: BiquadCoefficients = {
    b: [
      (vh + (vb * k1) / shelfQ + k1 * k1) / a0,
      (2 * (k1 * k1 - vh)) / a0,
      (vh - (vb * k1) / shelfQ + k1 * k1) / a0,
    ],
    a: [1, (2 * (k1 * k1 - 1)) / a0, (1 - k1 / shelfQ + k1 * k1) / a0],
  };
  // Stage 2: the RLB high-pass at about 38 Hz.
  const passHz = 38.13547087602444;
  const passQ = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * passHz) / sampleRate);
  const p0 = 1 + k2 / passQ + k2 * k2;
  const highPass: BiquadCoefficients = {
    b: [1, -2, 1],
    a: [1, (2 * (k2 * k2 - 1)) / p0, (1 - k2 / passQ + k2 * k2) / p0],
  };
  return [shelf, highPass];
}

/** LUFS from a summed, K-weighted mean square; silence is `-Infinity`. */
export function lufsOf(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

/** The short-term window: the last 3 s (EBU R 128). */
export const SHORT_TERM_SECONDS = 3;
/** A gating block: 400 ms, stepped every 100 ms (75% overlap). */
const SEGMENT_SECONDS = 0.1;
const SEGMENTS_PER_BLOCK = 4;
const SEGMENTS_PER_SHORT_TERM = SHORT_TERM_SECONDS / SEGMENT_SECONDS;
/** Blocks quieter than this never count towards the integrated figure. */
const ABSOLUTE_GATE_LUFS = -70;
/** And then nor do blocks this far under the ungated average. */
const RELATIVE_GATE_LU = 10;

/** What the meter reads now, in LUFS; `-Infinity` before anything is heard. */
export interface LoudnessReading {
  readonly shortTermLufs: number;
  readonly integratedLufs: number;
}

/**
 * Accumulates K-weighted signal into short-term and gated integrated loudness.
 *
 * It is fed in arbitrary slices — however much audio passed since the last
 * look — and cuts them into the 100 ms segments the standard steps in. A
 * segment's power is a duration-weighted mean, so a meter read at irregular
 * moments still measures time fairly. Each completed segment closes one
 * 400 ms gating block (the last four segments), and the integrated figure is
 * those blocks gated twice: absolutely at -70 LUFS, which is what keeps
 * silence between songs and before Play out of it, then relatively 10 LU
 * under the average of what is left.
 */
export class LoudnessAccumulator {
  private readonly segments: number[] = [];
  private pendingEnergy = 0;
  private pendingSeconds = 0;
  /** Every gating block's power since the last reset. */
  private readonly blocks: number[] = [];
  /** {@link integrated}, kept until a block closes: it is read every frame. */
  private integratedCache: number | null = null;

  /**
   * Adds `seconds` of audio whose K-weighted mean square, summed over the
   * channels, was `power`.
   */
  push(power: number, seconds: number): void {
    let left = seconds;
    while (left > 0) {
      const take = Math.min(left, SEGMENT_SECONDS - this.pendingSeconds);
      this.pendingEnergy += power * take;
      this.pendingSeconds += take;
      left -= take;
      if (this.pendingSeconds >= SEGMENT_SECONDS - 1e-9) this.closeSegment();
    }
  }

  private closeSegment(): void {
    this.segments.push(this.pendingEnergy / this.pendingSeconds);
    if (this.segments.length > SEGMENTS_PER_SHORT_TERM) this.segments.shift();
    this.pendingEnergy = 0;
    this.pendingSeconds = 0;
    if (this.segments.length >= SEGMENTS_PER_BLOCK) {
      this.blocks.push(mean(this.segments.slice(-SEGMENTS_PER_BLOCK)));
      this.integratedCache = null;
    }
  }

  /** The last 3 s (or as much as has been heard, if less). */
  shortTerm(): number {
    return this.segments.length > 0 ? lufsOf(mean(this.segments)) : -Infinity;
  }

  /** The whole programme since the last reset, gated. */
  integrated(): number {
    this.integratedCache ??= this.gatedIntegrated();
    return this.integratedCache;
  }

  private gatedIntegrated(): number {
    const audible = this.blocks.filter((power) => lufsOf(power) > ABSOLUTE_GATE_LUFS);
    if (audible.length === 0) return -Infinity;
    const relativeGate = lufsOf(mean(audible)) - RELATIVE_GATE_LU;
    const counted = audible.filter((power) => lufsOf(power) > relativeGate);
    return lufsOf(mean(counted));
  }

  reading(): LoudnessReading {
    return { shortTermLufs: this.shortTerm(), integratedLufs: this.integrated() };
  }

  /** Forgets the short-term window as well as the integrated programme. */
  reset(): void {
    this.segments.length = 0;
    this.blocks.length = 0;
    this.integratedCache = null;
    this.pendingEnergy = 0;
    this.pendingSeconds = 0;
  }
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
