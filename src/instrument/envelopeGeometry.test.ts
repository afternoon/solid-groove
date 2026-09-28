import { describe, expect, it } from "vitest";
import {
  envelopePoints,
  FLOOR,
  nearestHandle,
  PEAK,
  STAGE_SHARE,
  stageSeconds,
  stageWidth,
  sustainAt,
  svgPath,
} from "./envelopeGeometry";

describe("envelope geometry (#447)", () => {
  it("gives short times room and caps each stage's share", () => {
    expect(stageWidth(0, 4)).toBe(0);
    expect(stageWidth(4, 4)).toBeCloseTo(STAGE_SHARE);
    expect(stageWidth(99, 4)).toBeCloseTo(STAGE_SHARE);
    // 10 ms of a 4 s range is not a hairline: the square root spreads it.
    expect(stageWidth(0.01, 4)).toBeGreaterThan(0.01);
  });

  it("reads a dragged width back as the time it was drawn from", () => {
    for (const seconds of [0.005, 0.18, 1.2, 4]) {
      expect(stageSeconds(stageWidth(seconds, 4), 4)).toBeCloseTo(seconds);
    }
    expect(stageSeconds(-1, 4)).toBe(0);
    expect(stageSeconds(1, 4)).toBe(4);
  });

  it("maps height to sustain between the floor and the peak", () => {
    expect(sustainAt(FLOOR)).toBe(0);
    expect(sustainAt(PEAK)).toBe(1);
    expect(sustainAt(2)).toBe(1);
  });

  it("outlines attack, decay, hold and release left to right", () => {
    const points = envelopePoints({ attack: 1, decay: 1, sustain: 0.5, release: 1 }, 4);
    const xs = points.map(([x]) => x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(points[1][1]).toBe(PEAK);
    expect(points[2][1]).toBeCloseTo((FLOOR + PEAK) / 2);
    expect(points[4]).toEqual([1, FLOOR]);
  });

  it("picks the handle under the pointer", () => {
    const points = envelopePoints(
      { attack: 0.1, decay: 0.4, sustain: 0.6, release: 0.5 },
      4,
    );
    expect(nearestHandle(points, points[1][0], PEAK)).toBe(0);
    expect(nearestHandle(points, points[2][0] + 0.01, points[2][1])).toBe(1);
    expect(nearestHandle(points, 0.95, 0.5)).toBe(2);
  });

  it("writes SVG path data with y pointing down", () => {
    expect(
      svgPath(
        [
          [0, 0],
          [1, 1],
        ],
        300,
        100,
      ),
    ).toBe("M0.0,100.0 L300.0,0.0");
  });
});
