import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "../../arrangement/canvasRenderer";
import { drawSleeve, resolveSleevePalette, type SleeveFrame } from "./sleeveCanvas";

/** The sleeve's drawing, against a context that records what it is asked to paint. */

interface Painted {
  readonly op: "fillRect" | "strokeRect" | "fillText";
  readonly style: string;
  readonly alpha: number;
  readonly args: readonly unknown[];
}

function recordingContext() {
  const painted: Painted[] = [];
  const state = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 0,
    font: "",
  };
  const record = (op: Painted["op"], style: string, args: unknown[]) =>
    painted.push({ op, style, alpha: state.globalAlpha, args });
  const ctx = Object.assign(state, {
    fillRect: (...args: unknown[]) => record("fillRect", state.fillStyle, args),
    strokeRect: (...args: unknown[]) => record("strokeRect", state.strokeStyle, args),
    fillText: (...args: unknown[]) => record("fillText", state.fillStyle, args),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted, state };
}

const RED = "#ff0000";
const BLUE = "#0000ff";
const frame: SleeveFrame = {
  width: 400,
  height: 300,
  bars: 8,
  name: "Night Drive",
  meta: "120 BPM · 2:30",
  stripes: [
    { color: RED, lanes: [{ startBar: 0, lengthBars: 4 }] },
    { color: BLUE, lanes: [{ startBar: 2, lengthBars: 6 }] },
  ],
  palette: resolveSleevePalette(),
};

describe("drawSleeve", () => {
  it("paints black ground, then only the tracks' own colours for the stripes", () => {
    const { ctx, painted } = recordingContext();
    drawSleeve(ctx, frame, 1);
    const fills = painted.filter((paint) => paint.op === "fillRect");
    expect(fills[0].style).toBe(COLOR_TOKENS.background[1]);
    expect(fills.slice(1).map((paint) => paint.style)).toEqual([RED, BLUE]);
  });

  it("starts each stripe on its arrangement row and lands it in the square", () => {
    const start = recordingContext();
    drawSleeve(start.ctx, frame, 0);
    const [from] = start.painted.filter((paint) => paint.style === BLUE);
    // Row 1 of 2 in a 300px-high arrangement, full width, faint.
    expect(from.args.slice(0, 2)).toEqual([(2 / 8) * 400, 150]);
    expect(from.alpha).toBeCloseTo(0.25);

    const end = recordingContext();
    drawSleeve(end.ctx, frame, 1);
    const [to] = end.painted.filter((paint) => paint.style === BLUE);
    const side = 300 * 0.72;
    const ox = (400 - side) / 2;
    const oy = (300 - side) / 2 - 12;
    expect(to.args[0]).toBeCloseTo(ox + (2 / 8) * side);
    expect(to.args[1]).toBeCloseTo(oy + side / 2);
    expect(to.alpha).toBe(1);
  });

  it("frames the sleeve in white and names it, in capitals, only once landed", () => {
    const mid = recordingContext();
    drawSleeve(mid.ctx, frame, 0.5);
    expect(mid.painted.some((paint) => paint.op !== "fillRect")).toBe(false);

    const { ctx, painted, state } = recordingContext();
    drawSleeve(ctx, frame, 1);
    const [border] = painted.filter((paint) => paint.op === "strokeRect");
    expect(border.style).toBe(COLOR_TOKENS.playhead[1]);
    expect(state.lineWidth).toBe(1);
    const text = painted.filter((paint) => paint.op === "fillText");
    expect(text.map((paint) => paint.args[0])).toEqual(["NIGHT DRIVE", "120 BPM · 2:30"]);
    expect(text.map((paint) => paint.style)).toEqual([
      COLOR_TOKENS.playhead[1],
      COLOR_TOKENS.textMuted[1],
    ]);
  });

  it("draws no stripe in a colour that is not a track's, whatever the progress", () => {
    for (const progress of [0, 0.3, 1]) {
      const { ctx, painted } = recordingContext();
      drawSleeve(ctx, frame, progress);
      const colours = new Set(painted.map((paint) => paint.style));
      for (const colour of colours) {
        expect([
          RED,
          BLUE,
          COLOR_TOKENS.background[1],
          COLOR_TOKENS.playhead[1],
          COLOR_TOKENS.textMuted[1],
        ]).toContain(colour);
      }
    }
  });
});
