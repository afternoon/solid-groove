import { describe, expect, it } from "vitest";
import {
  type BiquadCoefficients,
  kWeighting,
  LoudnessAccumulator,
  lufsOf,
} from "./loudness";

/** Runs `input` through one biquad, direct form I. */
function biquad(input: Float64Array, { b, a }: BiquadCoefficients): Float64Array {
  const output = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  return output;
}

/** The K-weighted mean square of a `hz` sine at `amplitude`, after it settles. */
function weightedPower(hz: number, amplitude: number, sampleRate: number): number {
  const length = sampleRate * 2;
  const sine = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    sine[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  const [shelf, highPass] = kWeighting(sampleRate);
  const weighted = biquad(biquad(sine, shelf), highPass);
  let sum = 0;
  for (let i = sampleRate; i < length; i += 1) sum += weighted[i] ** 2;
  return sum / (length - sampleRate);
}

describe("K-weighting (BS.1770, #937)", () => {
  it("reproduces the standard's 48 kHz coefficients", () => {
    const [shelf, highPass] = kWeighting(48_000);
    const close = (actual: readonly number[], expected: readonly number[]) => {
      for (const [i, value] of actual.entries())
        expect(value).toBeCloseTo(expected[i], 8);
    };
    close(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    close(shelf.a, [1, -1.69065929318241, 0.73248077421585]);
    close(highPass.b, [1, -2, 1]);
    close(highPass.a, [1, -1.99004745483398, 0.99007225036621]);
  });

  it.each([44_100, 48_000, 96_000])(
    "reads a full-scale 1 kHz sine in both channels as 0 LUFS at %d Hz",
    (sampleRate) => {
      const perChannel = weightedPower(1_000, 1, sampleRate);
      expect(lufsOf(perChannel * 2)).toBeCloseTo(0, 1);
    },
  );

  it("lifts the highs and ignores rumble", () => {
    expect(lufsOf(weightedPower(8_000, 1, 48_000) * 2)).toBeGreaterThan(3);
    expect(lufsOf(weightedPower(20, 1, 48_000) * 2)).toBeLessThan(-10);
  });
});

describe("LoudnessAccumulator (EBU R 128, #937)", () => {
  /** `seconds` of a steady signal at `lufs`, fed in uneven slices. */
  function feed(meter: LoudnessAccumulator, lufs: number, seconds: number): void {
    const power = lufs === -Infinity ? 0 : 10 ** ((lufs + 0.691) / 10);
    let left = seconds;
    for (let i = 0; left > 1e-9; i += 1) {
      const slice = Math.min(left, i % 2 === 0 ? 0.016 : 0.017);
      meter.push(power, slice);
      left -= slice;
    }
  }

  it("reads nothing before anything is heard", () => {
    const meter = new LoudnessAccumulator();
    expect(meter.reading()).toEqual({
      shortTermLufs: -Infinity,
      integratedLufs: -Infinity,
    });
  });

  it("reads a steady signal at its own loudness", () => {
    const meter = new LoudnessAccumulator();
    feed(meter, -14, 5);
    expect(meter.shortTerm()).toBeCloseTo(-14, 6);
    expect(meter.integrated()).toBeCloseTo(-14, 6);
  });

  it("keeps the short-term figure to the last three seconds", () => {
    const meter = new LoudnessAccumulator();
    feed(meter, -10, 5);
    feed(meter, -30, 3);
    expect(meter.shortTerm()).toBeCloseTo(-30, 6);
  });

  it("gates silence out of the integrated figure", () => {
    const meter = new LoudnessAccumulator();
    feed(meter, -20, 4);
    feed(meter, -Infinity, 20);
    feed(meter, -20, 4);
    // Only the few blocks straddling an edge, part loud and part silent, count.
    expect(meter.integrated()).toBeCloseTo(-20, 0);
    expect(meter.integrated()).toBeGreaterThan(-20.5);
  });

  it("gates quiet passages more than 10 LU under the programme", () => {
    const meter = new LoudnessAccumulator();
    feed(meter, -10, 10);
    feed(meter, -40, 10);
    // Ungated, the quiet half would drag the average down by about 3 LU.
    expect(meter.integrated()).toBeGreaterThan(-10.2);
  });

  it("starts the programme over on reset", () => {
    const meter = new LoudnessAccumulator();
    feed(meter, -6, 10);
    meter.reset();
    expect(meter.integrated()).toBe(-Infinity);
    feed(meter, -18, 2);
    expect(meter.integrated()).toBeCloseTo(-18, 6);
  });
});
