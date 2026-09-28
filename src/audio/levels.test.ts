import { describe, expect, it } from "vitest";
import { loudestDb, peakDbOf } from "./levels";

describe("levels (#447)", () => {
  it("takes the louder channel of a stereo meter", () => {
    expect(loudestDb(-12)).toBe(-12);
    expect(loudestDb([-20, -6])).toBe(-6);
  });

  it("finds the loudest sample across channels, in dBFS", () => {
    expect(
      peakDbOf([Float32Array.from([0.1, -0.5]), Float32Array.from([0.25])]),
    ).toBeCloseTo(20 * Math.log10(0.5));
    expect(peakDbOf([Float32Array.from([1.2])])).toBeGreaterThan(0);
    expect(peakDbOf([new Float32Array(4)])).toBe(-Infinity);
  });
});
