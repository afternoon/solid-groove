import { describe, expect, it } from "vitest";
import {
  compressorOutput,
  delayEchoes,
  delayTime,
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

describe("compressor and delay drawings (#447)", () => {
  it("passes below the threshold and divides by the ratio above it", () => {
    expect(compressorOutput(-40, -20, 4, 0)).toBe(-40);
    expect(compressorOutput(0, -20, 4, 0)).toBe(-15);
    expect(compressorOutput(0, -20, 4, 6)).toBe(-9);
    // Inside the knee the curve bends between the two, continuously.
    const inKnee = compressorOutput(-20, -20, 4, 0);
    expect(inKnee).toBeLessThan(-20);
    expect(inKnee).toBeGreaterThan(-20 - 3);
  });

  it("times a synced delay from the tempo and a free one from its seconds", () => {
    expect(delayTime(true, 0.3, 1 / 4, 120)).toBe(0.5);
    expect(delayTime(true, 0.3, 1 / 8, 60)).toBe(0.5);
    expect(delayTime(false, 0.3, 1 / 4, 120)).toBe(0.3);
  });

  it("repeats each side at its own interval, falling by the feedback", () => {
    const echoes = delayEchoes(0.5, 0.5, 1);
    expect(echoes.filter((e) => e.side === "left").map((e) => [e.at, e.level])).toEqual([
      [0.5, 1],
      [1, 0.5],
      [1.5, 0.25],
      [2, 0.125],
    ]);
    expect(echoes.filter((e) => e.side === "right").map((e) => e.at)).toEqual([1, 2]);
    expect(delayEchoes(0, 0.5, 0)).toEqual([]);
  });
});
