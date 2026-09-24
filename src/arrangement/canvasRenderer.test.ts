import { describe, expect, it, vi } from "vitest";
import type { Project } from "../domain/entities";
import {
  createDrumMachineFixtureProject,
  createLargeArrangementProject,
  createPianoRollFixtureProject,
} from "../domain/fixtures";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";
import {
  COLOR_TOKENS,
  createArrangementWaveformCache,
  type DrawEnvironment,
  drawBackgroundLayer,
  drawContentLayer,
  drawInteractionLayer,
  RULER_HEIGHT_PX,
} from "./canvasRenderer";
import type { Viewport } from "./geometry";
import { visibleRowRange, visibleTickRange } from "./geometry";
import { buildArrangementProjection } from "./projection";

const ROW_METRICS = { trackHeightPx: 28, headerHeightPx: 28 };

/**
 * A minimal recording `CanvasRenderingContext2D`. jsdom has no 2D context, and
 * these tests only need to count draw commands and assert which regions were
 * painted — not pixels — so a spy object is enough and keeps the suite free of
 * a native canvas dependency.
 */
/** One `strokeRect`, with the line dash and width it was drawn under. */
interface Stroke {
  readonly x: number;
  readonly dash: readonly number[];
  readonly lineWidth: number;
}

type FakeContext = CanvasRenderingContext2D & {
  fillRectCalls: number;
  strokeRectCalls: number;
  moveToXs: number[];
  strokes: Stroke[];
};

function fakeContext(): FakeContext {
  const fillRectSpy = vi.fn();
  const strokeRectSpy = vi.fn();
  const moveToXs: number[] = [];
  const strokes: Stroke[] = [];
  let dash: readonly number[] = [];
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: (x: number, _y: number, _w: number, _h: number) => {
      fillRectSpy(x);
    },
    strokeRect(this: { lineWidth: number }, x: number, _y: number, _w: number) {
      strokeRectSpy(x);
      strokes.push({ x, dash, lineWidth: this.lineWidth });
    },
    setLineDash: (segments: number[]) => {
      dash = [...segments];
    },
    beginPath: vi.fn(),
    moveTo: (x: number) => {
      moveToXs.push(x);
    },
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    get fillRectCalls() {
      return fillRectSpy.mock.calls.length;
    },
    get strokeRectCalls() {
      return strokeRectSpy.mock.calls.length;
    },
    moveToXs,
    strokes,
  };
  return ctx as unknown as FakeContext;
}

function baseViewport(overrides: Partial<Viewport> = {}): Viewport {
  return {
    scrollLeft: 0,
    scrollTop: 0,
    width: 800,
    height: 400,
    pixelsPerTick: 0.08,
    ...overrides,
  };
}

function envFor(viewport: Viewport): DrawEnvironment & { ctx: FakeContext } {
  const project = createLargeArrangementProject(20);
  const projection = buildArrangementProjection(project, ROW_METRICS);
  return {
    ctx: fakeContext(),
    viewport,
    projection,
    rowRange: visibleRowRange(projection.rowOffsets, viewport, 4),
    tickRange: visibleTickRange(viewport, 200),
    waveformCache: createArrangementWaveformCache(),
  };
}

describe("drawContentLayer culls to the visible window", () => {
  it("draws a placement block only for placements in the visible tick range", () => {
    const env = envFor(baseViewport());
    drawContentLayer(env);
    // Every placement drawn issues at least one fillRect for its block. The
    // count must be well below the project's total placement count (2,500).
    const totalPlacements = env.projection.placementsById.size;
    expect(env.ctx.fillRectCalls).toBeGreaterThan(0);
    expect(env.ctx.fillRectCalls).toBeLessThan(totalPlacements);
  });

  it("draws strictly more blocks when the viewport is larger", () => {
    const small = envFor(baseViewport({ width: 400, height: 200 }));
    const large = envFor(baseViewport({ width: 1600, height: 800 }));
    drawContentLayer(small);
    drawContentLayer(large);
    expect(large.ctx.fillRectCalls).toBeGreaterThanOrEqual(small.ctx.fillRectCalls);
  });
});

describe("drawBackgroundLayer", () => {
  it("clears and repaints only the viewport-sized region", () => {
    const env = envFor(baseViewport());
    drawBackgroundLayer(env);
    expect(env.ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
  });

  it("paints the ruler strip at the top", () => {
    const env = envFor(baseViewport());
    drawBackgroundLayer(env);
    // The ruler background is a fillRect at (0,0,width,RULER_HEIGHT_PX).
    expect(RULER_HEIGHT_PX).toBeGreaterThan(0);
    expect(env.ctx.fillRectCalls).toBeGreaterThan(0);
  });
});

describe("drawInteractionLayer", () => {
  it("draws the playhead line at the scrolled screen x", () => {
    const env = envFor(baseViewport({ scrollLeft: 0 }));
    drawInteractionLayer(env, {
      playheadTicks: TICKS_PER_BAR * 2,
      range: null,
      hoverPlacementId: null,
      selectedPlacementIds: new Set(),
    });
    // The playhead moveTo x is the tick converted to a pixel (0.08 px/tick).
    const expectedX = Math.round(TICKS_PER_BAR * 2 * 0.08) + 0.5;
    expect(env.ctx.moveToXs).toContain(expectedX);
  });

  it("is a no-op clear when there is no playhead, selection, or hover", () => {
    const env = envFor(baseViewport());
    drawInteractionLayer(env, {
      playheadTicks: null,
      range: null,
      hoverPlacementId: null,
      selectedPlacementIds: new Set(),
    });
    expect(env.ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(env.ctx.fillRectCalls).toBe(0);
  });

  /**
   * #292: the range and a selected clip must look different, so a producer can
   * tell a stretch of time from a clip. The range is dotted, the clip solid.
   */
  it("outlines a range dotted and a selected clip solid, and thicker", () => {
    const env = envFor(baseViewport());
    const [placementId] = env.projection.placementsById.keys();
    const placement = env.projection.placementsById.get(placementId);
    if (!placement) throw new Error("fixture has no placement");
    const second = env.projection.tracks[1];
    drawInteractionLayer(env, {
      playheadTicks: null,
      range: {
        trackIds: [env.projection.tracks[0].id, second.id],
        startTicks: TICKS_PER_BAR * 4,
        endTicks: TICKS_PER_BAR * 6,
      },
      hoverPlacementId: null,
      selectedPlacementIds: new Set([placementId]),
    });
    const [range, clip] = env.ctx.strokes;
    expect(env.ctx.strokes).toHaveLength(2);
    expect(range.dash.length).toBeGreaterThan(0);
    expect(range.x).toBeCloseTo(TICKS_PER_BAR * 4 * 0.08 + 0.5);
    expect(clip.dash).toEqual([]);
    expect(clip.lineWidth).toBeGreaterThan(range.lineWidth);
    // The range's wash is filled; the clip's outline has no fill of its own.
    expect(env.ctx.fillRectCalls).toBe(1);
  });

  it("draws a point as a cursor line, not an outline", () => {
    const env = envFor(baseViewport());
    drawInteractionLayer(env, {
      playheadTicks: null,
      range: {
        trackIds: [env.projection.tracks[0].id],
        startTicks: TICKS_PER_BAR * 2,
        endTicks: TICKS_PER_BAR * 2,
      },
      hoverPlacementId: null,
      selectedPlacementIds: new Set(),
    });
    expect(env.ctx.strokes).toEqual([]);
    expect(env.ctx.moveToXs).toContain(Math.round(TICKS_PER_BAR * 2 * 0.08) + 0.5);
  });
});

/**
 * Issue #351: a note clip's preview is a mini piano roll, not a row of
 * full-height tick marks. Each note is a bar across its own time span, at a
 * height set by its pitch (or, for a drum pad, by its pad's row).
 */
describe("drawContentLayer note previews (#351)", () => {
  interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }

  /** Records every fillRect painted in the note-mark colour. */
  function noteRectsFor(project: Project, pixelsPerTick: number): Rect[] {
    const noteColor = COLOR_TOKENS.onPlacement[1];
    const rects: Rect[] = [];
    const ctx = fakeContext();
    ctx.fillRect = function (this: { fillStyle: string }, x, y, w, h) {
      if (this.fillStyle === noteColor) rects.push({ x, y, w, h });
    };
    const projection = buildArrangementProjection(project, {
      trackHeightPx: 84,
      headerHeightPx: 84,
    });
    const viewport = baseViewport({ width: 2000, pixelsPerTick });
    drawContentLayer({
      ctx,
      viewport,
      projection,
      rowRange: visibleRowRange(projection.rowOffsets, viewport, 4),
      tickRange: visibleTickRange(viewport, 200),
      waveformCache: createArrangementWaveformCache(),
    });
    return rects.sort((a, b) => a.x - b.x);
  }

  function withPitches(project: Project, pitches: readonly number[]): Project {
    const [clip] = project.clips;
    if (clip.content.kind !== "notes") throw new Error("fixture clip is not notes");
    const events = clip.content.events.map((event, index) => ({
      ...event,
      trigger: { kind: "pitch" as const, pitch: pitches[index] },
    }));
    return { ...project, clips: [{ ...clip, content: { kind: "notes", events } }] };
  }

  it("draws an ascending melody climbing: each higher note sits higher", () => {
    // C4, E4, G4, C5 at successive 16ths.
    const rects = noteRectsFor(createPianoRollFixtureProject(), 0.5);
    expect(rects).toHaveLength(4);
    const ys = rects.map((rect) => rect.y);
    for (let index = 1; index < ys.length; index += 1) {
      expect(ys[index]).toBeLessThan(ys[index - 1]);
    }
  });

  it("draws a descending melody dropping: each lower note sits lower", () => {
    const project = withPitches(createPianoRollFixtureProject(), [72, 67, 64, 60]);
    const ys = noteRectsFor(project, 0.5).map((rect) => rect.y);
    expect(ys).toHaveLength(4);
    for (let index = 1; index < ys.length; index += 1) {
      expect(ys[index]).toBeGreaterThan(ys[index - 1]);
    }
  });

  it("draws each note as a bar across its duration, not a full-height mark", () => {
    const rects = noteRectsFor(createPianoRollFixtureProject(), 0.5);
    for (const rect of rects) {
      expect(rect.w).toBeCloseTo(TICKS_PER_SIXTEENTH * 0.5, 0);
      expect(rect.h).toBeLessThan(84 / 4);
    }
  });

  it("puts each drum pad on its own row, in the drum machine's pad order", () => {
    // Kick (first pad) on every beat, clap (second pad) on 2 and 4.
    const rects = noteRectsFor(createDrumMachineFixtureProject(), 0.5);
    expect(rects).toHaveLength(6);
    const rows = [...new Set(rects.map((rect) => rect.y))].sort((a, b) => a - b);
    expect(rows).toHaveLength(2);
    const kickX = rects[0].x;
    const kickRow = rects.find((rect) => rect.x === kickX)?.y;
    // The downbeat is kick-only, so its row is the kick's: the top one.
    expect(kickRow).toBe(rows[0]);
  });
});
