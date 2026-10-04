import { EQ_BANDS, type EqBand } from "../../domain/devices";

/**
 * The EQ's filter stages and their response, kept free of Tone so the engine
 * (`eq.ts`) and the editor's drawing of the curve read the very same settings
 * and the very same maths (LOOP-022). The drawing is therefore the sound's
 * shape, not an illustration of it.
 *
 * Every stage is one Web Audio `BiquadFilterNode`, and {@link stageMagnitude}
 * is the Web Audio specification's own coefficient formulas for it, so the
 * curve matches `getFrequencyResponse` on the real node (see `eq.test.ts`).
 */

/** A Web Audio biquad type, as `eq.ts` sets it on a node. */
export type EqStageType = "highpass" | "lowshelf" | "peaking" | "highshelf" | "lowpass";

/** One biquad in the EQ, with its values in the node's own units. */
export interface EqStageSetting {
  /** The band it belongs to, and which of the band's stages it is. */
  readonly band: string;
  readonly type: EqStageType;
  readonly frequency: number;
  /**
   * The node's `Q`, which Web Audio reads in decibels for a low- or high-pass
   * and as a plain quality factor for a peak (and ignores for a shelf).
   */
  readonly q: number;
  readonly gain: number;
  /**
   * Whether the stage is in the signal. Only a cut is ever switched out this
   * way: a shelf or a peak switched off is the same filter at 0 dB, which is
   * no filter at all, so it never needs a second path around it.
   */
  readonly active: boolean;
}

/**
 * The Q of a plain shelf. Web Audio's shelves have no Q of their own: they are
 * the cookbook shelf at a slope of 1, which is this. A shelf's Q above it is
 * resonance at the corner, added by a peak riding on the shelf.
 */
export const PLAIN_SHELF_Q = 0.71;

/** The sample rate the editor draws at; the engine's own differs only near 20 kHz. */
export const DRAWING_SAMPLE_RATE = 48_000;

type Values = Readonly<Record<string, number>>;

const isOn = (values: Values, band: EqBand) => values[`${band.id}On`] >= 0.5;

/**
 * How much of a shelf's gain its corner peak adds: nothing for a plain shelf,
 * rising towards the whole gain as its Q climbs. Keeping it proportional to
 * the gain means a flat shelf stays flat whatever its Q.
 */
export function shelfResonance(q: number): number {
  return Math.max(0, 1 - PLAIN_SHELF_Q / q);
}

/**
 * Every biquad the EQ runs, in signal order, for a set of fully defaulted
 * values. A shelf is two stages — the shelf and its corner peak — and every
 * other band one.
 */
export function eqStageSettings(values: Values): EqStageSetting[] {
  const stages: EqStageSetting[] = [];
  for (const band of EQ_BANDS) {
    const on = isOn(values, band);
    const frequency = values[`${band.id}Freq`];
    const q = values[`${band.id}Q`];
    const gain = on ? (values[`${band.id}Gain`] ?? 0) : 0;
    switch (band.kind) {
      case "lowCut":
      case "highCut":
        stages.push({
          band: band.id,
          type: band.kind === "lowCut" ? "highpass" : "lowpass",
          frequency,
          // Web Audio reads a low- or high-pass Q in decibels.
          q: 20 * Math.log10(q),
          gain: 0,
          active: on,
        });
        break;
      case "lowShelf":
      case "highShelf":
        stages.push(
          {
            band: band.id,
            type: band.kind === "lowShelf" ? "lowshelf" : "highshelf",
            frequency,
            q,
            gain,
            active: true,
          },
          {
            band: band.id,
            type: "peaking",
            frequency,
            q,
            gain: gain * shelfResonance(q),
            active: true,
          },
        );
        break;
      case "peak":
        stages.push({ band: band.id, type: "peaking", frequency, q, gain, active: true });
        break;
    }
  }
  return stages;
}

/** One biquad's normalised coefficients. */
interface Coefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/**
 * A stage's coefficients, exactly as the Web Audio specification computes a
 * `BiquadFilterNode`'s ("Filters characteristics"), normalised by `a0`.
 */
function coefficients(stage: EqStageSetting, sampleRate: number): Coefficients {
  const nyquist = sampleRate / 2;
  const f0 = Math.min(nyquist, Math.max(0, stage.frequency));
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (stage.gain / 40);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  switch (stage.type) {
    case "lowpass":
    case "highpass": {
      const alpha = sin / (2 * 10 ** (stage.q / 20));
      const sign = stage.type === "lowpass" ? -1 : 1;
      b0 = (1 + sign * cos) / 2;
      b1 = -sign * (1 + sign * cos);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "peaking": {
      const alpha = sin / (2 * stage.q);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
    case "lowshelf":
    case "highshelf": {
      // The specification fixes the shelf slope S at 1.
      const alpha = (sin / 2) * Math.SQRT2;
      const k = 2 * alpha * Math.sqrt(A);
      const s = stage.type === "lowshelf" ? 1 : -1;
      b0 = A * (A + 1 - s * (A - 1) * cos + k);
      b1 = s * 2 * A * (A - 1 - s * (A + 1) * cos);
      b2 = A * (A + 1 - s * (A - 1) * cos - k);
      a0 = A + 1 + s * (A - 1) * cos + k;
      a1 = -s * 2 * (A - 1 + s * (A + 1) * cos);
      a2 = A + 1 + s * (A - 1) * cos - k;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** A stage's linear magnitude at `hz`; 1 for a stage switched out. */
export function stageMagnitude(
  stage: EqStageSetting,
  hz: number,
  sampleRate = DRAWING_SAMPLE_RATE,
): number {
  if (!stage.active) return 1;
  const { b0, b1, b2, a1, a2 } = coefficients(stage, sampleRate);
  const w = (2 * Math.PI * hz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (1 + a1 e^-jw + a2 e^-2jw)
  const numRe = b0 + b1 * c1 + b2 * c2;
  const numIm = -(b1 * s1 + b2 * s2);
  const denRe = 1 + a1 * c1 + a2 * c2;
  const denIm = -(a1 * s1 + a2 * s2);
  return Math.sqrt((numRe ** 2 + numIm ** 2) / (denRe ** 2 + denIm ** 2));
}

/** The whole EQ's gain at `hz`, in dB, for a set of fully defaulted values. */
export function eqResponseDb(
  values: Values,
  hz: number,
  sampleRate = DRAWING_SAMPLE_RATE,
): number {
  return eqStagesResponseDb(eqStageSettings(values), hz, sampleRate);
}

/** The gain at `hz`, in dB, through a list of stages already worked out. */
export function eqStagesResponseDb(
  stages: readonly EqStageSetting[],
  hz: number,
  sampleRate = DRAWING_SAMPLE_RATE,
): number {
  let magnitude = 1;
  for (const stage of stages) magnitude *= stageMagnitude(stage, hz, sampleRate);
  return 20 * Math.log10(Math.max(magnitude, 1e-9));
}
