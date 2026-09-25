/**
 * Production Canvas 2D drawing for the arrangement shell's three stacked layers
 * (`ARR-001`; PRD 9.3 "Layered drawing and invalidation"). Promoted from the
 * FND-008 spike's `spike/canvasLayers.ts`, with the ruler (bar numbers and
 * section labels) folded into the background layer.
 *
 * Every function here reads only `ArrangementProjection`/geometry data and
 * draws the visible range it is given. It never touches domain-shaped data and
 * never iterates anything outside `rowRange`/`tickRange` — frame cost is
 * proportional to visible objects, not project duration (PRD 9.3).
 */

import type { PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import type { RowRange, TickRange, Viewport } from "./geometry";
import { ticksToPixels } from "./geometry";
import type { ArrangementProjection, PlacementGeometry } from "./projection";
import { visiblePlacements } from "./projection";
import {
  createWaveformCache,
  selectPeakLevel,
  type WaveformCache,
} from "./waveformCache";

/** Height in CSS pixels of the ruler strip across the top of the timeline. */
export const RULER_HEIGHT_PX = 16;

/** Space kept clear above and below a clip's note preview. */
const NOTE_PREVIEW_INSET_PX = 6;
/** The tallest a preview note bar gets, however few rows the clip uses. */
const MAX_NOTE_BAR_HEIGHT_PX = 6;

export interface DrawEnvironment {
  readonly ctx: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly projection: ArrangementProjection;
  readonly rowRange: RowRange;
  readonly tickRange: TickRange;
  readonly waveformCache: WaveformCache;
  /**
   * The song's loop brace (`LOOP-018`), drawn on the ruler in the background
   * pass. Optional so a host with no loop to show draws the ruler bare.
   */
  readonly loop?: LoopBraceDrawState | null;
}

/** What the ruler needs to draw the loop brace: its range and whether it is on. */
export interface LoopBraceDrawState {
  readonly startTicks: number;
  readonly endTicks: number;
  readonly enabled: boolean;
}

export interface InteractionState {
  readonly playheadTicks: number | null;
  readonly selection: {
    readonly trackId: TrackId;
    readonly startTick: number;
    readonly endTick: number;
  } | null;
  readonly hoverPlacementId: PlacementId | null;
  /** Placement-editing selection (`ARR-002`; PRD CLP-01) — entities selected
   * by ID, distinct from `selection`'s bar range. */
  readonly selectedPlacementIds: ReadonlySet<PlacementId>;
}

/**
 * The palette, resolved from `src/theme.css` at runtime.
 *
 * A canvas cannot consume a CSS custom property, so the tokens are read off the
 * document once and cached. The literals below are fallbacks for a context that
 * has no stylesheet applied — jsdom under the unit suite — and are pinned to the
 * theme by `canvasRenderer.test.ts`, so they cannot drift away from it silently.
 */
export const COLOR_TOKENS = {
  /* The grid is the ground, so it is black and the ruler rises off it — the
     inverse of a palette whose darkest surface is a well. */
  background: ["--color-background", "#000000"],
  ruler: ["--color-background-secondary", "#141414"],
  /* Alternating rows are a tint rather than a step: nothing sits below black,
     and borrowing the ground costs no shade. */
  rowAlt: ["--tint-subtle", "rgb(255 255 255 / 4%)"],
  gridBeat: ["--color-border", "#292929"],
  gridBar: ["--color-border-strong", "#474747"],
  text: ["--color-foreground", "#a6a6a6"],
  rulerText: ["--color-text-secondary", "#d9d9d9"],
  playhead: ["--color-accent", "#ffffff"],
  selection: ["--color-accent-wash", "rgb(255 255 255 / 15%)"],
  selectionBorder: ["--color-accent", "#ffffff"],
  hover: ["--color-text", "#f6f6f6"],
  placementSelection: ["--color-accent-wash-strong", "rgb(255 255 255 / 28%)"],
  /* Note ticks and the waveform centre line are drawn over a track's own
     colour — the one hue on screen — so they shade what is beneath rather
     than naming a colour of their own. */
  onPlacement: ["--shade-medium", "rgb(0 0 0 / 45%)"],
  onPlacementStrong: ["--scrim", "rgb(0 0 0 / 70%)"],
  /* The loop brace is one band. Looping on is the brightest step and looping
     off the recessive one, so the toggle reads on the brace itself — state is
     brightness here, as everywhere else. */
  loopBrace: ["--color-accent", "#ffffff"],
  loopBraceOff: ["--tint-soft", "rgb(255 255 255 / 8%)"],
  /* Ruler text over a switched-on brace inverts to a dark step, so it stays
     readable on the white band. */
  rulerTextOnBrace: ["--color-background-tertiary", "#292929"],
} as const satisfies Record<string, readonly [string, string]>;

type ColorName = keyof typeof COLOR_TOKENS;

let resolved: Record<ColorName, string> | null = null;

/** Drop the cached palette so the next draw re-reads the theme. Tests only. */
export function resetArrangementPalette(): void {
  resolved = null;
}

function resolvePalette(): Record<ColorName, string> {
  const style =
    typeof window === "undefined"
      ? null
      : window.getComputedStyle(document.documentElement);
  const palette = {} as Record<ColorName, string>;
  for (const name of Object.keys(COLOR_TOKENS) as ColorName[]) {
    const [token, fallback] = COLOR_TOKENS[name];
    palette[name] = style?.getPropertyValue(token).trim() || fallback;
  }
  return palette;
}

function colors(): Record<ColorName, string> {
  resolved ??= resolvePalette();
  return resolved;
}

/** Rows begin below the ruler; the ruler is a fixed strip that does not scroll. */
function contentTopOffset(): number {
  return RULER_HEIGHT_PX;
}

function screenX(tick: number, viewport: Viewport): number {
  return ticksToPixels(tick, viewport) - viewport.scrollLeft;
}

function rowTop(rowIndex: number, projection: ArrangementProjection): number {
  return projection.rowOffsets[rowIndex] + contentTopOffset();
}

export function createArrangementWaveformCache(): WaveformCache {
  return createWaveformCache();
}

export function clearLayer(env: DrawEnvironment): void {
  env.ctx.clearRect(0, 0, env.viewport.width, env.viewport.height);
}

/** Bar/beat grid, row backgrounds, and the bar/section ruler — changes only on
 * zoom, scroll, section edit, or track-count change. */
export function drawBackgroundLayer(env: DrawEnvironment): void {
  const { ctx, viewport, projection, rowRange } = env;
  clearLayer(env);
  ctx.fillStyle = colors().background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const top = contentTopOffset();
  const rowHeight = projection.rowMetrics.trackHeightPx;
  for (let rowIndex = rowRange.startRow; rowIndex <= rowRange.endRow; rowIndex += 1) {
    if (rowIndex % 2 === 1) {
      const y = rowTop(rowIndex, projection) - viewport.scrollTop;
      ctx.fillStyle = colors().rowAlt;
      ctx.fillRect(0, y, viewport.width, rowHeight);
    }
  }

  // One line per row boundary, continuing past the last track to the bottom of
  // the view. Tall rows need the horizontal rule the alternating fill used to
  // stand in for: with 84px of space a clip no longer touches its neighbours,
  // so without a line there is nothing to say where one track's lane ends.
  // Drawn beyond the last row on purpose — the empty area below the song is
  // still the timeline, and a grid that stops mid-view reads as a broken edge.
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors().gridBeat;
  const firstLine = Math.max(0, Math.floor((viewport.scrollTop - top) / rowHeight));
  for (let line = firstLine; ; line += 1) {
    const y = Math.round(top + line * rowHeight - viewport.scrollTop) + 0.5;
    if (y > viewport.height) break;
    if (y >= top) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewport.width, y);
      ctx.stroke();
    }
  }

  const firstBar = Math.floor(env.tickRange.startTick / TICKS_PER_BAR);
  const lastBar = Math.ceil(env.tickRange.endTick / TICKS_PER_BAR);
  ctx.lineWidth = 1;
  for (let bar = firstBar; bar <= lastBar; bar += 1) {
    const x = Math.round(screenX(bar * TICKS_PER_BAR, viewport)) + 0.5;
    ctx.strokeStyle = bar % 4 === 0 ? colors().gridBar : colors().gridBeat;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, viewport.height);
    ctx.stroke();
  }

  drawRuler(env, firstBar, lastBar);
}

/** The bar-number and section-label strip across the top of the timeline. */
function drawRuler(env: DrawEnvironment, firstBar: number, lastBar: number): void {
  const { ctx, viewport } = env;
  ctx.fillStyle = colors().ruler;
  ctx.fillRect(0, 0, viewport.width, RULER_HEIGHT_PX);

  if (env.loop) drawLoopBrace(env, env.loop);

  drawRulerLabels(env, firstBar, lastBar, colors().text, colors().rulerText);
  // Over a switched-on brace the labels are drawn again, clipped to the brace
  // and inverted, so each glyph reads dark on white where it crosses it.
  const brace = env.loop?.enabled ? braceSpan(env, env.loop) : null;
  if (brace) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(brace.left, 0, brace.width, RULER_HEIGHT_PX);
    ctx.clip();
    const onBrace = colors().rulerTextOnBrace;
    drawRulerLabels(env, firstBar, lastBar, onBrace, onBrace);
    ctx.restore();
  }
}

/** Section names and bar numbers, in the given colours. */
function drawRulerLabels(
  env: DrawEnvironment,
  firstBar: number,
  lastBar: number,
  barColor: string,
  sectionColor: string,
): void {
  const { ctx, viewport, projection } = env;
  // Section ranges labelled in their own color; sections that fall entirely
  // outside the visible tick range are skipped (culling).
  for (const section of projection.sections) {
    const left = screenX(section.startTicks, viewport);
    const right = screenX(section.endTicks, viewport);
    if (right < 0 || left > viewport.width) continue;
    ctx.fillStyle = section.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(Math.max(0, left), 0, Math.max(1, right - left), 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = sectionColor;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(section.name, Math.max(2, left + 4), RULER_HEIGHT_PX / 2);
  }

  // Bar numbers every 4 bars, so labels do not crowd at small zoom.
  ctx.fillStyle = barColor;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (let bar = firstBar; bar <= lastBar; bar += 1) {
    if (bar % 4 !== 0) continue;
    const x = screenX(bar * TICKS_PER_BAR, viewport);
    if (x < -20 || x > viewport.width) continue;
    ctx.fillText(`${bar + 1}`, x + 3, RULER_HEIGHT_PX / 2);
  }
}

/** The brace's on-screen span, or null when it is scrolled out of view. */
function braceSpan(
  env: DrawEnvironment,
  loop: LoopBraceDrawState,
): { left: number; width: number } | null {
  const left = screenX(loop.startTicks, env.viewport);
  const right = screenX(loop.endTicks, env.viewport);
  if (right < 0 || left > env.viewport.width) return null;
  return { left, width: Math.max(1, right - left) };
}

/**
 * The loop brace: one rectangle covering the full height of the ruler, like
 * GarageBand's cycle region. Drawn before the labels, which invert over it.
 */
function drawLoopBrace(env: DrawEnvironment, loop: LoopBraceDrawState): void {
  const span = braceSpan(env, loop);
  if (!span) return;
  env.ctx.fillStyle = loop.enabled ? colors().loopBrace : colors().loopBraceOff;
  env.ctx.fillRect(span.left, 0, span.width, RULER_HEIGHT_PX);
}

function drawPlacement(env: DrawEnvironment, placement: PlacementGeometry): void {
  const { ctx, viewport, projection } = env;
  const left = screenX(placement.startTicks, viewport);
  const right = screenX(placement.endTicks, viewport);
  const top = rowTop(placement.rowIndex, projection) - viewport.scrollTop + 2;
  const height = projection.rowMetrics.trackHeightPx - 4;
  const width = Math.max(1, right - left);

  ctx.fillStyle = placement.color;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(left, top, width, height);
  ctx.globalAlpha = 1;

  if (placement.preview.kind === "waveform") {
    drawWaveformPreview(env, placement, left, top, width, height);
  } else {
    drawNotePreview(env, placement, left, width, top, height);
  }
}

function drawNotePreview(
  env: DrawEnvironment,
  placement: PlacementGeometry,
  left: number,
  width: number,
  top: number,
  height: number,
): void {
  const { preview } = placement;
  if (preview.kind !== "notes" || preview.laneCount === 0) return;
  const { ctx } = env;
  const durationTicks = placement.endTicks - placement.startTicks;
  if (durationTicks <= 0) return;
  // A mini piano roll: each note is a bar across its own time span, on the row
  // its pitch (or pad) maps to. Few rows would make fat blocks, so a bar is
  // capped in height and centred on its row.
  const innerTop = top + NOTE_PREVIEW_INSET_PX;
  const laneHeight = (height - 2 * NOTE_PREVIEW_INSET_PX) / preview.laneCount;
  const barHeight = Math.max(1, Math.min(laneHeight, MAX_NOTE_BAR_HEIGHT_PX));
  const pixelsPerTick = width / durationTicks;
  const right = left + width;
  ctx.fillStyle = colors().onPlacement;
  for (const note of preview.notes) {
    const x = left + note.startTicks * pixelsPerTick;
    if (x >= right) continue;
    const barWidth = Math.min(Math.max(1, note.durationTicks * pixelsPerTick), right - x);
    const y = innerTop + (note.lane + 0.5) * laneHeight - barHeight / 2;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}

function drawWaveformPreview(
  env: DrawEnvironment,
  placement: PlacementGeometry,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  if (placement.preview.kind !== "waveform") return;
  const { ctx, waveformCache } = env;
  const peaks = waveformCache.get(
    placement.preview.assetId,
    placement.preview.assetRevision,
    4,
  );
  const targetBuckets = Math.max(1, Math.round(width));
  const level = selectPeakLevel(peaks, targetBuckets);
  const mid = top + height / 2;

  ctx.strokeStyle = colors().onPlacementStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let bucket = 0; bucket < level.bucketCount; bucket += 1) {
    const x = left + (bucket / level.bucketCount) * width;
    const max = level.max[bucket];
    const min = level.min[bucket];
    ctx.moveTo(x, mid - max * (height / 2));
    ctx.lineTo(x, mid - min * (height / 2));
  }
  ctx.stroke();
}

/** Clip blocks, note/waveform previews, and automation — changes on scroll,
 * zoom, or a content revision bump; not on playhead/hover/selection alone. */
export function drawContentLayer(env: DrawEnvironment): void {
  clearLayer(env);
  const visible = visiblePlacements(env.projection, env.tickRange, env.rowRange);
  for (const placement of visible) {
    drawPlacement(env, placement);
  }
  drawAutomationLanes(env);
}

function drawAutomationLanes(env: DrawEnvironment): void {
  const { ctx, viewport, projection, rowRange } = env;
  for (let rowIndex = rowRange.startRow; rowIndex <= rowRange.endRow; rowIndex += 1) {
    const track = projection.tracks[rowIndex];
    if (!track) continue;
    const lane = projection.automationByTrack.get(track.id);
    if (!lane || lane.points.length === 0) continue;

    const top = rowTop(rowIndex, projection) - viewport.scrollTop;
    const height = projection.rowMetrics.trackHeightPx;
    ctx.strokeStyle = colors().playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let previousY: number | null = null;
    for (const point of lane.points) {
      const x = screenX(point.tick, viewport);
      if (x < -8 || x > viewport.width + 8) continue;
      const normalized = 1 - Math.max(0, Math.min(1, (point.value + 1) / 2));
      const y = top + 4 + normalized * (height - 8);
      if (previousY === null) {
        ctx.moveTo(x, y);
      } else if (lane.interpolation === "step") {
        ctx.lineTo(x, previousY);
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      previousY = y;
    }
    if (previousY !== null) ctx.stroke();
  }
}

/** Playhead, selection, and hover — the only layer redrawn on every pointer
 * move or transport tick, so it must stay cheap regardless of project size. */
export function drawInteractionLayer(
  env: DrawEnvironment,
  interaction: InteractionState,
): void {
  clearLayer(env);
  const { ctx, viewport, projection } = env;
  const rulerTop = contentTopOffset();

  if (interaction.selection) {
    const { trackId, startTick, endTick } = interaction.selection;
    const rowIndex = projection.tracks.find((track) => track.id === trackId)?.rowIndex;
    if (rowIndex !== undefined) {
      const left = screenX(startTick, viewport);
      const right = screenX(endTick, viewport);
      const top = rowTop(rowIndex, projection) - viewport.scrollTop;
      ctx.fillStyle = colors().selection;
      ctx.fillRect(left, top, right - left, projection.rowMetrics.trackHeightPx);
      ctx.strokeStyle = colors().selectionBorder;
      ctx.strokeRect(left, top, right - left, projection.rowMetrics.trackHeightPx);
    }
  }

  // Selected placements (ARR-002): a thicker, filled border so the highlight
  // reads as distinct from the plain hover outline below even when a
  // placement is both selected and hovered at once.
  for (const placementId of interaction.selectedPlacementIds) {
    const placement = projection.placementsById.get(placementId);
    if (!placement) continue;
    const left = screenX(placement.startTicks, viewport);
    const right = screenX(placement.endTicks, viewport);
    const top = rowTop(placement.rowIndex, projection) - viewport.scrollTop;
    const height = projection.rowMetrics.trackHeightPx;
    ctx.fillStyle = colors().placementSelection;
    ctx.fillRect(left, top, Math.max(1, right - left), height);
    ctx.strokeStyle = colors().selectionBorder;
    ctx.lineWidth = 3;
    ctx.strokeRect(left + 1.5, top + 1.5, Math.max(1, right - left - 3), height - 3);
  }

  if (interaction.hoverPlacementId) {
    const placement = projection.placementsById.get(interaction.hoverPlacementId);
    if (placement) {
      const left = screenX(placement.startTicks, viewport);
      const right = screenX(placement.endTicks, viewport);
      const top = rowTop(placement.rowIndex, projection) - viewport.scrollTop;
      ctx.strokeStyle = colors().hover;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        left + 1,
        top + 1,
        Math.max(1, right - left - 2),
        projection.rowMetrics.trackHeightPx - 2,
      );
    }
  }

  if (interaction.playheadTicks !== null) {
    const x = Math.round(screenX(interaction.playheadTicks, viewport)) + 0.5;
    ctx.strokeStyle = colors().playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // The playhead spans the ruler too, so it reads as one line from the top.
    ctx.moveTo(x, rulerTop - RULER_HEIGHT_PX);
    ctx.lineTo(x, viewport.height);
    ctx.stroke();
  }
}
