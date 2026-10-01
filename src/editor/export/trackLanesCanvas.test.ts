import { afterEach, describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "../../arrangement/canvasRenderer";
import {
  drawLanes,
  type LaneBatches,
  type LaneDrawRow,
  printedFraction,
  resetLanePalette,
  resolveLanePalette,
} from "./trackLanesCanvas";

afterEach(() => {
  resetLanePalette();
  document.documentElement.removeAttribute("style");
});

const none: LaneBatches = { batches: [], doneBatches: [], printing: null };
const three: LaneBatches = {
  batches: [["a", "b"], ["c"], ["d"]],
  doneBatches: [0],
  printing: { batchIndex: 1, fraction: 0.4 },
};

describe("printedFraction", () => {
  it("is full for a finished batch, partial for the current one, zero otherwise", () => {
    expect(printedFraction("a", true, three)).toBe(1);
    expect(printedFraction("c", true, three)).toBe(0.4);
    expect(printedFraction("d", true, three)).toBe(0);
  });

  it("never prints a left-out row", () => {
    expect(printedFraction("a", false, three)).toBe(0);
  });

  it("prints every row together when there are no batches", () => {
    const printing = { batchIndex: 0, fraction: 0.5 };
    expect(printedFraction("a", true, { ...none, printing })).toBe(0.5);
    expect(printedFraction("a", true, none)).toBe(0);
  });
});

describe("resolveLanePalette", () => {
  it("falls back to the arrangement renderer's pinned literals without a stylesheet", () => {
    expect(resolveLanePalette().ruler).toBe(COLOR_TOKENS.ruler[1]);
  });

  it("reads the theme's custom properties off the document once", () => {
    const root = document.documentElement.style;
    root.setProperty("--color-background-secondary", "#010101");
    expect(resolveLanePalette().ruler).toBe("#010101");
    root.setProperty("--color-background-secondary", "#020202");
    expect(resolveLanePalette().ruler).toBe("#010101");
  });
});

describe("drawLanes", () => {
  const lane = { startBar: 0, lengthBars: 8 };
  const row = (over: Partial<LaneDrawRow>): LaneDrawRow => ({
    id: "a",
    color: "#ff0000",
    included: true,
    picked: false,
    lanes: [lane],
    ...over,
  });

  function draw(rows: LaneDrawRow[], batches = none) {
    const calls: { fill: string; alpha: number; rect: number[] }[] = [];
    const state = { fill: "", alpha: 1 };
    const ctx = {
      clearRect() {},
      set fillStyle(value: string) {
        state.fill = value;
      },
      set globalAlpha(value: number) {
        state.alpha = value;
      },
      fillRect(...rect: number[]) {
        calls.push({ fill: state.fill, alpha: state.alpha, rect });
      },
    } as unknown as CanvasRenderingContext2D;
    drawLanes(ctx, {
      width: 160,
      rows,
      bars: 16,
      palette: resolveLanePalette(),
      batches,
    });
    return calls;
  }
  const body = (calls: ReturnType<typeof draw>, fill: string) =>
    calls.find((call) => call.fill === fill && call.rect[3] === 14);

  it("draws a clip in the track's colour, brighter when the row is on", () => {
    const on = body(draw([row({})]), "#ff0000");
    const off = body(draw([row({ included: false })]), "#ff0000");
    expect(on?.rect).toEqual([1, 5, 78, 14]);
    expect(on?.alpha).toBeGreaterThan(off?.alpha ?? 1);
  });

  it("highlights a picked row across the full width", () => {
    const calls = draw([row({ picked: true, lanes: [] })]);
    const wash = resolveLanePalette().loopBraceOff;
    expect(calls.some((call) => call.fill === wash && call.rect[2] === 160)).toBe(true);
  });

  it("prints a finished row to full opacity", () => {
    const done: LaneBatches = { batches: [["a"]], doneBatches: [0], printing: null };
    const calls = draw([row({ color: "#0000ff" })], done);
    expect(
      calls.filter((call) => call.fill === "#0000ff" && call.alpha === 1),
    ).toHaveLength(1);
  });
});
