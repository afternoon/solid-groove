import { describe, expect, it } from "vitest";
import {
  overdriveTransfer,
  REVERB_WINDOW,
  reverbTailPath,
  reverbTiming,
  saturatorTransfer,
  transferPath,
} from "./deviceDrawings";

describe("device drawings (#447)", () => {
  it("drives an overdrive harder, and clips its negative half sooner", () => {
    // Clean at zero drive is close to the bare curve; more drive, more squash.
    expect(overdriveTransfer(0, 0)).toBe(0);
    expect(Math.abs(overdriveTransfer(1, 0.05))).toBeGreaterThan(
      Math.abs(overdriveTransfer(0, 0.05)),
    );
    expect(Math.abs(overdriveTransfer(0.5, -0.3))).toBeGreaterThan(
      overdriveTransfer(0.5, 0.3),
    );
  });

  it("morphs a saturator from a soft knee to a fold with its character", () => {
    const soft = saturatorTransfer(6, 0, 0.9);
    const fold = saturatorTransfer(6, 1, 0.9);
    expect(soft).toBeGreaterThan(0);
    // Past the knee the fold turns back on itself.
    expect(fold).toBeLessThan(soft);
    expect(saturatorTransfer(0, 0, 0)).toBe(0);
  });

  it("draws a transfer across the box, clamped inside it", () => {
    const ys = transferPath((x) => 3 * x, 300, 100)
      .split(" ")
      .map((point) => Number(point.slice(1).split(",")[1]));
    expect(ys).toHaveLength(121);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(100);
  });

  it("scales a reverb's pre-delay and decay with its size, as the engine does", () => {
    expect(reverbTiming(2, 0, 0.01)).toEqual({ predelay: 0.01, decay: 1 });
    expect(reverbTiming(2, 1, 0.01)).toEqual({
      predelay: expect.closeTo(0.06, 5),
      decay: 3,
    });
  });

  it("ramps the tail down from the end of the pre-delay to the end of the decay", () => {
    // Pre-delay 0.5 s + 25 ms of size; decay 2 s × (0.5 + 0.5) = 2 s.
    expect(reverbTailPath(2, 0.5, 0.5, REVERB_WINDOW * 10, 100)).toBe(
      "M5.3,100 L5.3,5.0 L25.3,100.0 L25.3,100 Z",
    );
  });

  it("cuts a tail longer than the window where it leaves", () => {
    const path = reverbTailPath(30, 1, 0, 80, 100);
    expect(path).toContain("L80.0,");
    expect(path).not.toContain("L80.0,100.0");
  });
});
