import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createSliceFixtureProject } from "../domain/fixtures";
import { TICKS_PER_BAR } from "../domain/time";
import { createArrangementShell } from "./arrangementShell";
import {
  COLOR_TOKENS,
  createArrangementWaveformCache,
  drawBackgroundLayer,
  type LoopBraceDrawState,
  RULER_HEIGHT_PX,
} from "./canvasRenderer";
import { visibleRowRange, visibleTickRange } from "./geometry";
import { buildArrangementProjection } from "./projection";
import { useArrangementCanvas } from "./useArrangementCanvas";

/**
 * The loop brace is drawn on the ruler in the background layer's own paint
 * pass (`LOOP-018`), not as an overlay element. These assert which rectangles
 * that pass fills and in which palette step — not pixels, since jsdom has no
 * 2D context.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** A 2D context that records every `fillRect` with the fill it was made in. */
function recordingContext(rects: Rect[]): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: String(ctx.fillStyle) });
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const projection = buildArrangementProjection(createSliceFixtureProject(), {
  trackHeightPx: 28,
  headerHeightPx: 28,
});

// 0.1 px per tick puts the end of bar 2 at 153.6 px.
const viewport = {
  scrollLeft: 0,
  scrollTop: 0,
  width: 800,
  height: 200,
  pixelsPerTick: 0.1,
};
const BAR_TWO_END_PX = 2 * TICKS_PER_BAR * 0.1;
const barsOneToTwo = { startTicks: 0, endTicks: 2 * TICKS_PER_BAR };

function draw(loop: LoopBraceDrawState | null): Rect[] {
  const rects: Rect[] = [];
  drawBackgroundLayer({
    ctx: recordingContext(rects),
    viewport,
    projection,
    rowRange: visibleRowRange(projection.rowOffsets, viewport, 0),
    tickRange: visibleTickRange(viewport, 0),
    waveformCache: createArrangementWaveformCache(),
    loop,
  });
  return rects;
}

const inRuler = (rect: Rect) => rect.y + rect.h <= RULER_HEIGHT_PX;

describe("the loop brace on the ruler", () => {
  it("draws a band and two bracket ends inside the ruler strip", () => {
    const braceFills: string[] = [
      COLOR_TOKENS.loopBrace[1],
      COLOR_TOKENS.loopBraceEdge[1],
    ];
    const rects = draw({ ...barsOneToTwo, enabled: true }).filter(
      (rect) => inRuler(rect) && braceFills.includes(rect.fill),
    );
    expect(rects.map((rect) => rect.fill)).toEqual([
      COLOR_TOKENS.loopBrace[1],
      COLOR_TOKENS.loopBraceEdge[1],
      COLOR_TOKENS.loopBraceEdge[1],
    ]);
    const [band, left, right] = rects;
    expect(band.x).toBe(0);
    expect(band.w).toBeCloseTo(BAR_TWO_END_PX);
    expect(left).toMatchObject({ x: 0, y: 0, h: RULER_HEIGHT_PX });
    expect(right.x + right.w).toBeCloseTo(BAR_TWO_END_PX);
  });

  it("draws a switched-off brace in the recessive step, where it still is", () => {
    const fills = draw({ ...barsOneToTwo, enabled: false }).map((rect) => rect.fill);
    expect(fills).toContain(COLOR_TOKENS.loopBraceOff[1]);
    expect(fills).toContain(COLOR_TOKENS.loopBraceOffEdge[1]);
    expect(fills).not.toContain(COLOR_TOKENS.loopBraceEdge[1]);
  });

  it("draws nothing extra for a host with no loop", () => {
    const fills = draw(null).map((rect) => rect.fill);
    expect(fills).not.toContain(COLOR_TOKENS.loopBrace[1]);
    expect(fills).not.toContain(COLOR_TOKENS.loopBraceOff[1]);
  });

  it("is painted by the canvas hook's background pass from the loop it is given", () => {
    const rects: Rect[] = [];
    const canvas = (record: boolean) => {
      const element = document.createElement("canvas");
      const ctx = recordingContext(record ? rects : []);
      element.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
      return element;
    };
    const canvases = {
      background: canvas(true),
      content: canvas(false),
      interaction: canvas(false),
    };
    const shell = createArrangementShell(() => projection, {
      initialViewport: viewport,
      onDirty: () => {},
    });
    createRoot((dispose) => {
      const hook = useArrangementCanvas({
        shell: () => shell,
        projection: () => projection,
        canvases: () => canvases,
        interactionState: () => ({
          playheadTicks: null,
          selection: null,
          hoverPlacementId: null,
          selectedPlacementIds: new Set(),
        }),
        waveformCache: createArrangementWaveformCache(),
        loop: () => ({ ...barsOneToTwo, enabled: true }),
      });
      shell.markDirty("background");
      hook.drawDirtyLayers();
      dispose();
    });
    expect(rects.map((rect) => rect.fill)).toContain(COLOR_TOKENS.loopBraceEdge[1]);
  });
});
