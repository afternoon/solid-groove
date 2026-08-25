import { describe, expect, it } from "vitest";
import { TICKS_PER_SIXTEENTH } from "../domain/time";
import {
  clientXToTick,
  clientYToPitch,
  noteIntersectsRect,
  noteRect,
  type PianoRollViewport,
  pitchToContentY,
  snapTicks,
  snapTicksFloor,
  tickToContentX,
} from "./pianoRollGeometry";

/** A viewport with no scroll — the un-scrolled baseline. */
const base: PianoRollViewport = {
  pixelsPerTick: 0.5,
  rowHeight: 20,
  scrollTicks: 0,
  scrollTop: 0,
  topPitch: 96,
};

describe("pianoRollGeometry", () => {
  it("maps ticks to content-x by the zoom", () => {
    expect(tickToContentX(base, 0)).toBe(0);
    expect(tickToContentX(base, 192)).toBe(96);
    expect(tickToContentX({ ...base, pixelsPerTick: 1 }, 192)).toBe(192);
  });

  it("maps pitch to content-y with high pitches at the top", () => {
    expect(pitchToContentY(base, 96)).toBe(0);
    expect(pitchToContentY(base, 95)).toBe(20);
    expect(pitchToContentY(base, 84)).toBe(240);
  });

  describe("pointer geometry stays correct under scroll and zoom", () => {
    it("resolves the same on-screen pixel to a later tick when scrolled right", () => {
      // The content element's left edge sits at client x=100.
      const contentLeft = 100;
      // Unscrolled: a pointer 96px into the content is tick 192 at 0.5 px/tick.
      expect(clientXToTick(base, contentLeft, 196)).toBeCloseTo(192);
      // Scroll right by 100 ticks: the same screen pixel is now 100 ticks later.
      const scrolled = { ...base, scrollTicks: 100 };
      expect(clientXToTick(scrolled, contentLeft, 196)).toBeCloseTo(292);
    });

    it("resolves a wider tick span per pixel when zoomed out", () => {
      const contentLeft = 0;
      const zoomedOut = { ...base, pixelsPerTick: 0.25 };
      // 96 screen px is 192 ticks at 0.5, but 384 ticks at 0.25.
      expect(clientXToTick(base, contentLeft, 96)).toBeCloseTo(192);
      expect(clientXToTick(zoomedOut, contentLeft, 96)).toBeCloseTo(384);
    });

    it("resolves a lower pitch when vertically scrolled down", () => {
      const contentTop = 0;
      // Row 0 (top) is pitch 96; one row down is 95.
      expect(clientYToPitch(base, contentTop, 10)).toBe(96);
      expect(clientYToPitch(base, contentTop, 30)).toBe(95);
      // Scroll down two rows (40px): the top visible row is now pitch 94.
      const scrolled = { ...base, scrollTop: 40 };
      expect(clientYToPitch(scrolled, contentTop, 10)).toBe(94);
    });

    it("clamps pitch to the MIDI range under extreme scroll", () => {
      const far = { ...base, scrollTop: 100_000 };
      expect(clientYToPitch(far, 0, 10)).toBe(0);
      const negative = { ...base, topPitch: 0 };
      expect(clientYToPitch(negative, 0, 10)).toBe(0);
    });
  });

  describe("16th-note snap", () => {
    it("snaps to the nearest 16th", () => {
      expect(snapTicks(0)).toBe(0);
      expect(snapTicks(TICKS_PER_SIXTEENTH - 1)).toBe(TICKS_PER_SIXTEENTH);
      expect(snapTicks(TICKS_PER_SIXTEENTH * 2 + 5)).toBe(TICKS_PER_SIXTEENTH * 2);
    });

    it("never returns a negative tick", () => {
      expect(snapTicks(-10)).toBe(0);
      expect(snapTicksFloor(-10)).toBe(0);
    });

    it("floors to the grid line at or before a position", () => {
      expect(snapTicksFloor(TICKS_PER_SIXTEENTH + 1)).toBe(TICKS_PER_SIXTEENTH);
      expect(snapTicksFloor(TICKS_PER_SIXTEENTH * 3 - 1)).toBe(TICKS_PER_SIXTEENTH * 2);
    });
  });

  it("gives a note a rectangle at least one pixel wide", () => {
    const rect = noteRect(base, {
      startTicks: 96,
      durationTicks: 1,
      pitch: 95,
    });
    expect(rect.left).toBe(48);
    expect(rect.top).toBe(20);
    expect(rect.height).toBe(20);
    expect(rect.width).toBeGreaterThanOrEqual(1);
  });

  describe("marquee hit test", () => {
    const note = { startTicks: 192, durationTicks: 192, pitch: 90 };

    it("selects a note whose rectangle overlaps the marquee", () => {
      // Note occupies x 96..192, y (96-90)*20=120..140.
      const rect = { left: 100, right: 150, top: 125, bottom: 135 };
      expect(noteIntersectsRect(base, note, rect)).toBe(true);
    });

    it("excludes a note entirely outside the marquee", () => {
      const rect = { left: 300, right: 400, top: 0, bottom: 10 };
      expect(noteIntersectsRect(base, note, rect)).toBe(false);
    });
  });
});
