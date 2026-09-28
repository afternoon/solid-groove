import { describe, expect, it } from "vitest";
import { TRACK_PALETTE, TRACK_PALETTE_COLUMNS } from "./trackPalette";

describe("TRACK_PALETTE (#534)", () => {
  it("is 5 rows of 10, every value a #rrggbb, all distinct", () => {
    expect(TRACK_PALETTE_COLUMNS).toBe(10);
    expect(TRACK_PALETTE).toHaveLength(50);
    for (const color of TRACK_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(TRACK_PALETTE).size).toBe(50);
  });

  it("opens with a grey ramp from near-white to near-black", () => {
    const greys = TRACK_PALETTE.slice(0, 10);
    const level = (c: string) => Number.parseInt(c.slice(1, 3), 16);
    for (const c of greys) expect(c.slice(1, 3)).toBe(c.slice(3, 5));
    expect(level(greys[0] as string)).toBeGreaterThan(240);
    expect(level(greys[9] as string)).toBeLessThan(20);
    const levels = greys.map(level);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });
});
