import { describe, expect, it } from "vitest";
import { frequencyAt, positionOf, responseDb, responsePath } from "./filterResponse";
import { oscillatorPath } from "./OscillatorWell";

describe("filter response (#447)", () => {
  it("runs a log axis from 20 Hz to 20 kHz and back", () => {
    expect(frequencyAt(0)).toBe(20);
    expect(frequencyAt(1)).toBeCloseTo(20_000);
    expect(frequencyAt(1 / 3)).toBeCloseTo(200);
    expect(positionOf(frequencyAt(0.42))).toBeCloseTo(0.42);
  });

  it("passes below a low-pass cutoff and cuts above it", () => {
    expect(responseDb("lowpass", 50, 1000, Math.SQRT1_2)).toBeCloseTo(0, 1);
    expect(responseDb("lowpass", 10_000, 1000, Math.SQRT1_2)).toBeLessThan(-35);
  });

  it("cuts below a high-pass cutoff and peaks a band-pass at it", () => {
    expect(responseDb("highpass", 100, 1000, Math.SQRT1_2)).toBeLessThan(-35);
    expect(responseDb("highpass", 15_000, 1000, Math.SQRT1_2)).toBeCloseTo(0, 1);
    expect(responseDb("bandpass", 1000, 1000, 2)).toBeCloseTo(0, 5);
  });

  it("rises at the cutoff with resonance", () => {
    expect(responseDb("lowpass", 1000, 1000, 10)).toBeCloseTo(20, 5);
  });

  it("draws 91 points across the box, clamped to the drawn range", () => {
    const path = responsePath("lowpass", 1000, 20, 300, 100);
    const points = path.split(" ");
    expect(points).toHaveLength(91);
    for (const point of points) {
      const y = Number(point.slice(1).split(",")[1]);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});

describe("oscillator shape (#447)", () => {
  it("draws two cycles of each waveform inside the well", () => {
    for (const waveform of ["sine", "square", "sawtooth", "triangle"] as const) {
      const ys = oscillatorPath(waveform)
        .split(" ")
        .map((point) => Number(point.slice(1).split(",")[1]));
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
      expect(Math.max(...ys)).toBeLessThanOrEqual(90);
    }
    expect(oscillatorPath("square")).not.toBe(oscillatorPath("sine"));
  });
});
