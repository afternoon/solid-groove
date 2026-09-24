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

interface Text {
  text: string;
  fill: string;
  clipped: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/**
 * A 2D context that records every `fillRect` with the fill it was made in, and
 * every `fillText` with its fill and whether a clip was active.
 */
function recordingContext(rects: Rect[], texts: Text[] = []): CanvasRenderingContext2D {
  let clipped = false;
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    font: "",
    textBaseline: "",
    globalAlpha: 1,
    save() {},
    restore() {
      clipped = false;
    },
    rect() {},
    clip() {
      clipped = true;
    },
    fillText(text: string) {
      texts.push({ text, fill: String(ctx.fillStyle), clipped });
    },
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

function draw(loop: LoopBraceDrawState | null, texts: Text[] = []): Rect[] {
  const rects: Rect[] = [];
  drawBackgroundLayer({
    ctx: recordingContext(rects, texts),
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
  it("draws the brace as one rectangle covering the whole ruler", () => {
    const rects = draw({ ...barsOneToTwo, enabled: true }).filter(
      (rect) => inRuler(rect) && rect.fill === COLOR_TOKENS.loopBrace[1],
    );
    expect(rects).toHaveLength(1);
    const [band] = rects;
    expect(band).toMatchObject({ x: 0, y: 0, h: RULER_HEIGHT_PX });
    expect(band.w).toBeCloseTo(BAR_TWO_END_PX);
  });

  it("inverts the bar numbers over a switched-on brace, clipped to it", () => {
    const texts: Text[] = [];
    draw({ ...barsOneToTwo, enabled: true }, texts);
    const barOne = texts.filter((entry) => entry.text === "1");
    expect(barOne).toEqual([
      { text: "1", fill: COLOR_TOKENS.text[1], clipped: false },
      { text: "1", fill: COLOR_TOKENS.rulerTextOnBrace[1], clipped: true },
    ]);
  });

  it("keeps the labels light over a switched-off brace", () => {
    const texts: Text[] = [];
    draw({ ...barsOneToTwo, enabled: false }, texts);
    expect(texts.map((entry) => entry.fill)).not.toContain(
      COLOR_TOKENS.rulerTextOnBrace[1],
    );
  });

  it("draws a switched-off brace in the recessive step, where it still is", () => {
    const rects = draw({ ...barsOneToTwo, enabled: false });
    const off = rects.filter((rect) => rect.fill === COLOR_TOKENS.loopBraceOff[1]);
    expect(off).toHaveLength(1);
    expect(off[0].w).toBeCloseTo(BAR_TWO_END_PX);
    expect(rects.map((rect) => rect.fill)).not.toContain(COLOR_TOKENS.loopBrace[1]);
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
          range: null,
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
    expect(rects.map((rect) => rect.fill)).toContain(COLOR_TOKENS.loopBrace[1]);
  });
});
