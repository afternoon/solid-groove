import { describe, expect, it } from "vitest";
import { builtInMakeupGainDb } from "./compressorMakeup";

describe("builtInMakeupGainDb (#884)", () => {
  it("is zero for a curve that does not compress", () => {
    // Threshold at 0 dBFS, 1:1, no knee: the node's unity curve, which is how
    // the compressor's dry-leg aligner is set.
    expect(builtInMakeupGainDb(-1e-6, 0, 1)).toBeCloseTo(0, 4);
  });

  it("matches the gain the node was measured adding", () => {
    // The #884 regression render measured a -26 dBFS sine coming out of the
    // uncancelled node 4.50 dB louder at -18 dB, 2:1 and the core's 6 dB knee
    // (under the threshold, so that is the makeup alone). The issue's rougher
    // +5.4 dB ignores the knee, which pulls the curve's 0 dBFS point down less.
    expect(builtInMakeupGainDb(-18, 6, 2)).toBeCloseTo(4.5, 1);
    // A hard knee is the issue's arithmetic: 0 dBFS out at -9 dB, x 0.6.
    expect(builtInMakeupGainDb(-18, 0, 2)).toBeCloseTo(5.4, 1);
  });

  it("grows as the ratio rises and the threshold falls", () => {
    expect(builtInMakeupGainDb(-18, 6, 4)).toBeGreaterThan(
      builtInMakeupGainDb(-18, 6, 2),
    );
    expect(builtInMakeupGainDb(-30, 6, 4)).toBeGreaterThan(
      builtInMakeupGainDb(-18, 6, 4),
    );
  });

  it("stays finite across the registered extremes", () => {
    for (const threshold of [-60, -1e-6]) {
      for (const ratio of [1, 20]) {
        const db = builtInMakeupGainDb(threshold, 6, ratio);
        expect(Number.isFinite(db)).toBe(true);
        expect(db).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
