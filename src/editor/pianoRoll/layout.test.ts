import { describe, expect, it } from "vitest";
import {
  autoScrollSpeed,
  clampZoom,
  grabAt,
  isDrag,
  noteBox,
  ROW_HEIGHT,
  rectFrom,
  rowAt,
  scrollForZoom,
  stepAt,
  stepWidth,
  touches,
} from "./layout";

describe("piano roll layout", () => {
  it("draws 40 x 30 cells at 100%, and zoom only changes the step width", () => {
    expect(stepWidth(1)).toBe(40);
    expect(stepWidth(2)).toBe(80);
    expect(stepWidth(0.5)).toBe(20);
    expect(ROW_HEIGHT).toBe(30);
  });

  it("keeps zoom between 50% and 200%", () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(5)).toBe(2);
    expect(stepWidth(9)).toBe(80);
  });

  it("finds the step and row under a content point", () => {
    expect(stepAt(0, 1)).toBe(0);
    expect(stepAt(39.9, 1)).toBe(0);
    expect(stepAt(40, 1)).toBe(1);
    expect(stepAt(40, 2)).toBe(0);
    expect(stepAt(-1, 1)).toBe(-1);
    expect(rowAt(29)).toBe(0);
    expect(rowAt(30)).toBe(1);
  });

  it("places a note on its steps and row, with the gap off its far edges", () => {
    // Two steps (96 ticks) from step 3 (144 ticks), on row 5.
    expect(noteBox(144, 96, 5, 1)).toEqual({
      left: 120,
      top: 150,
      width: 78,
      height: 28,
    });
    expect(noteBox(144, 96, 5, 2)).toEqual({
      left: 240,
      top: 150,
      width: 158,
      height: 28,
    });
  });

  it("keeps a very short note clickable", () => {
    expect(noteBox(0, 1, 0, 0.5).width).toBe(4);
  });

  it("grabs a note's ends to resize it and its middle to move it", () => {
    expect(grabAt(2, 38)).toBe("start");
    expect(grabAt(36, 38)).toBe("end");
    expect(grabAt(19, 38)).toBe("body");
    // On a short note the ends shrink to a third each, leaving a middle.
    expect(grabAt(9, 18)).toBe("body");
  });

  it("calls a press that moves under 4 px a click", () => {
    expect(isDrag(2, 3)).toBe(false);
    expect(isDrag(3, 3)).toBe(true);
    expect(isDrag(4, 0)).toBe(true);
  });

  it("builds a lasso whichever way it was drawn, and a flat one still touches", () => {
    expect(rectFrom(10, 40, 2, 5)).toEqual({ left: 2, top: 5, right: 10, bottom: 40 });
    const box = { left: 0, top: 0, width: 38, height: 28 };
    expect(touches(box, rectFrom(20, 14, 200, 14))).toBe(true);
    expect(touches(box, rectFrom(40, 14, 200, 14))).toBe(false);
    expect(touches(box, rectFrom(0, 29, 10, 50))).toBe(false);
  });

  it("zooms around the anchor, keeping its step in place", () => {
    // Step 10 is under the anchor at 100% (scrolled 200 px, anchor at 200 px).
    const next = scrollForZoom(200, 200, 1, 2);
    expect((next + 200) / stepWidth(2)).toBe(10);
    expect(scrollForZoom(0, 0, 1, 0.5)).toBe(0);
  });

  it("auto-scrolls only against an edge, faster the closer it gets", () => {
    expect(autoScrollSpeed(200, 0, 400)).toBe(0);
    // The middle of a 30 px row in view is at least 15 px in: no scroll.
    expect(autoScrollSpeed(385, 0, 400)).toBe(0);
    expect(autoScrollSpeed(15, 0, 400)).toBe(0);
    expect(autoScrollSpeed(399, 0, 400)).toBeGreaterThan(autoScrollSpeed(392, 0, 400));
    expect(autoScrollSpeed(392, 0, 400)).toBeGreaterThan(0);
    expect(autoScrollSpeed(5, 0, 400)).toBeLessThan(0);
    // Past the edge it tops out rather than running away.
    expect(autoScrollSpeed(900, 0, 400)).toBe(autoScrollSpeed(500, 0, 400));
  });
});
