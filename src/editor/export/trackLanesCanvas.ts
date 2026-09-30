import { COLOR_TOKENS } from "../../arrangement/canvasRenderer";

/**
 * The mini-arrangement's canvas (EXP-004). A canvas cannot read a custom
 * property, so its greys come off the document once, the way
 * `src/arrangement/canvasRenderer.ts` resolves its own. The tokens are that
 * renderer's, so the fallbacks used where no stylesheet applies (jsdom) are
 * the ones `theme.test.ts` already pins to the theme. Hue comes only from a
 * row's own track colour.
 */

export const ROW_HEIGHT_PX = 24;
/** The mini-arrangement's columns: names, the batch gutter, then the lanes. */
export const NAME_COLUMN_PX = 260;
export const GUTTER_PX = 26;

const TOKEN_NAMES = ["ruler", "loopBraceOff", "text"] as const;
type PaletteName = (typeof TOKEN_NAMES)[number];
export type LanePalette = Readonly<Record<PaletteName, string>>;

let resolved: LanePalette | null = null;

/** Drop the cached palette so the next draw re-reads the theme. Tests only. */
export function resetLanePalette(): void {
  resolved = null;
}

export function resolveLanePalette(): LanePalette {
  if (resolved) return resolved;
  const style =
    typeof window === "undefined"
      ? null
      : window.getComputedStyle(document.documentElement);
  const palette = {} as Record<PaletteName, string>;
  for (const name of TOKEN_NAMES) {
    const [token, fallback] = COLOR_TOKENS[name];
    palette[name] = style?.getPropertyValue(token).trim() || fallback;
  }
  resolved = palette;
  return palette;
}

export interface LaneDrawRow {
  readonly id: string;
  readonly color: string | null;
  readonly included: boolean;
  readonly picked: boolean;
  readonly lanes: readonly { readonly startBar: number; readonly lengthBars: number }[];
}

export interface PrintState {
  /** Which batch (by index into `batches`) is being printed. */
  readonly batchIndex: number;
  /** How much of that batch is printed, 0..1. */
  readonly fraction: number;
}

export interface LaneBatches {
  readonly batches: readonly (readonly string[])[];
  readonly doneBatches: readonly number[];
  readonly printing: PrintState | null;
}

/**
 * How much of a row's lane is printed, 0..1: nothing for a row that is left
 * out, everything for a row in a finished batch, `fraction` for a row in the
 * batch being printed. With no batches (a stereo mix) every row is one batch.
 */
export function printedFraction(
  rowId: string,
  included: boolean,
  state: LaneBatches,
): number {
  if (!included) return 0;
  const { batches, doneBatches, printing } = state;
  const batch = batches.findIndex((ids) => ids.includes(rowId));
  if (batch >= 0 && doneBatches.includes(batch)) return 1;
  if (!printing) return 0;
  if (batches.length === 0 || batch === printing.batchIndex) return printing.fraction;
  return 0;
}

export interface DrawLanesInput {
  readonly width: number;
  readonly rows: readonly LaneDrawRow[];
  readonly bars: number;
  readonly palette: LanePalette;
  readonly batches: LaneBatches;
}

/** Draw every row's clips on the bar grid. A left-out row draws dim. */
export function drawLanes(ctx: CanvasRenderingContext2D, input: DrawLanesInput): void {
  const { width, rows, bars, palette, batches } = input;
  const height = rows.length * ROW_HEIGHT_PX;
  const barPx = width / Math.max(1, bars);
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.ruler;
  for (let bar = 0; bar <= bars; bar += 16)
    ctx.fillRect(Math.round(bar * barPx), 0, 1, height);
  rows.forEach((row, index) => {
    const y = index * ROW_HEIGHT_PX;
    if (row.picked) {
      ctx.fillStyle = palette.loopBraceOff;
      ctx.fillRect(0, y, width, ROW_HEIGHT_PX);
    }
    const printedPx = printedFraction(row.id, row.included, batches) * width;
    ctx.fillStyle = row.color ?? palette.text;
    for (const span of row.lanes) {
      const x0 = span.startBar * barPx + 1;
      const x1 = (span.startBar + span.lengthBars) * barPx - 1;
      ctx.globalAlpha = row.included ? 0.32 : 0.07;
      ctx.fillRect(x0, y + 5, x1 - x0, ROW_HEIGHT_PX - 10);
      if (printedPx > x0) {
        ctx.globalAlpha = 1;
        ctx.fillRect(x0, y + 5, Math.min(x1, printedPx) - x0, ROW_HEIGHT_PX - 10);
      }
      ctx.globalAlpha = row.included ? 0.9 : 0.15;
      ctx.fillRect(x0, y + 5, x1 - x0, 2);
    }
    ctx.globalAlpha = 1;
  });
}
