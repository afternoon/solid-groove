import type { PlacementId, TrackId } from "../../domain/ids";
import { TICKS_PER_BAR } from "../../domain/time";
import type { RowRange, TickRange, Viewport } from "../geometry";
import { ticksToPixels } from "../geometry";
import type { ArrangementProjection, PlacementGeometry } from "../projection";
import { visiblePlacements } from "../projection";
import {
	createWaveformCache,
	selectPeakLevel,
	type WaveformCache,
} from "../waveformCache";

/**
 * Canvas 2D drawing for the FND-008 spike's three stacked layers (PRD 9.3
 * "Layered drawing and invalidation"). Every function here only reads
 * `ArrangementProjection`/geometry data and draws the visible range it is
 * given — it never touches domain-shaped data and never iterates anything
 * outside `rowRange`/`tickRange`.
 */

export interface DrawEnvironment {
	readonly ctx: CanvasRenderingContext2D;
	readonly viewport: Viewport;
	readonly projection: ArrangementProjection;
	readonly rowRange: RowRange;
	readonly tickRange: TickRange;
	readonly waveformCache: WaveformCache;
}

export interface InteractionState {
	readonly playheadTicks: number | null;
	readonly selection: {
		readonly trackId: TrackId;
		readonly startTick: number;
		readonly endTick: number;
	} | null;
	readonly hoverPlacementId: PlacementId | null;
}

const COLORS = {
	background: "#141414",
	rowAlt: "#181818",
	gridBeat: "#262626",
	gridBar: "#383838",
	text: "#8a8a8a",
	playhead: "#20c8e8",
	selection: "rgba(32, 200, 232, 0.18)",
	selectionBorder: "#20c8e8",
	hover: "#e6e6e6",
};

function screenX(tick: number, viewport: Viewport): number {
	return ticksToPixels(tick, viewport) - viewport.scrollLeft;
}

function rowTop(rowIndex: number, projection: ArrangementProjection): number {
	return projection.rowOffsets[rowIndex];
}

export function createSpikeWaveformCache(): WaveformCache {
	return createWaveformCache();
}

export function clearLayer(env: DrawEnvironment): void {
	env.ctx.clearRect(0, 0, env.viewport.width, env.viewport.height);
}

/** Bar/beat grid and row backgrounds — changes only on zoom, scroll, or track-count change. */
export function drawBackgroundLayer(env: DrawEnvironment): void {
	const { ctx, viewport, projection, rowRange } = env;
	clearLayer(env);
	ctx.fillStyle = COLORS.background;
	ctx.fillRect(0, 0, viewport.width, viewport.height);

	for (
		let rowIndex = rowRange.startRow;
		rowIndex <= rowRange.endRow;
		rowIndex += 1
	) {
		if (rowIndex % 2 === 1) {
			const top = rowTop(rowIndex, projection) - viewport.scrollTop;
			ctx.fillStyle = COLORS.rowAlt;
			ctx.fillRect(0, top, viewport.width, projection.rowMetrics.trackHeightPx);
		}
	}

	const firstBar = Math.floor(env.tickRange.startTick / TICKS_PER_BAR);
	const lastBar = Math.ceil(env.tickRange.endTick / TICKS_PER_BAR);
	ctx.strokeStyle = COLORS.gridBeat;
	ctx.lineWidth = 1;
	for (let bar = firstBar; bar <= lastBar; bar += 1) {
		const x = Math.round(screenX(bar * TICKS_PER_BAR, viewport)) + 0.5;
		ctx.strokeStyle = bar % 4 === 0 ? COLORS.gridBar : COLORS.gridBeat;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, viewport.height);
		ctx.stroke();
	}
}

function drawPlacement(
	env: DrawEnvironment,
	placement: PlacementGeometry,
): void {
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
	if (placement.preview.kind !== "notes") return;
	const { ctx } = env;
	const durationTicks = placement.endTicks - placement.startTicks;
	if (durationTicks <= 0) return;
	ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
	for (const noteTick of placement.preview.noteStartTicks) {
		const fraction = noteTick / durationTicks;
		const x = left + fraction * width;
		ctx.fillRect(x, top + 2, 2, height - 4);
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

	ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
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
	const visible = visiblePlacements(
		env.projection,
		env.tickRange,
		env.rowRange,
	);
	for (const placement of visible) {
		drawPlacement(env, placement);
	}
	drawAutomationLanes(env);
}

function drawAutomationLanes(env: DrawEnvironment): void {
	const { ctx, viewport, projection, rowRange } = env;
	for (
		let rowIndex = rowRange.startRow;
		rowIndex <= rowRange.endRow;
		rowIndex += 1
	) {
		const track = projection.tracks[rowIndex];
		if (!track) continue;
		const lane = projection.automationByTrack.get(track.id);
		if (!lane || lane.points.length === 0) continue;

		const top = rowTop(rowIndex, projection) - viewport.scrollTop;
		const height = projection.rowMetrics.trackHeightPx;
		ctx.strokeStyle = COLORS.playhead;
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

	if (interaction.selection) {
		const { trackId, startTick, endTick } = interaction.selection;
		const rowIndex = projection.tracks.find(
			(track) => track.id === trackId,
		)?.rowIndex;
		if (rowIndex !== undefined) {
			const left = screenX(startTick, viewport);
			const right = screenX(endTick, viewport);
			const top = rowTop(rowIndex, projection) - viewport.scrollTop;
			ctx.fillStyle = COLORS.selection;
			ctx.fillRect(
				left,
				top,
				right - left,
				projection.rowMetrics.trackHeightPx,
			);
			ctx.strokeStyle = COLORS.selectionBorder;
			ctx.strokeRect(
				left,
				top,
				right - left,
				projection.rowMetrics.trackHeightPx,
			);
		}
	}

	if (interaction.hoverPlacementId) {
		const placement = env.projection.placementsById.get(
			interaction.hoverPlacementId,
		);
		if (placement) {
			const left = screenX(placement.startTicks, viewport);
			const right = screenX(placement.endTicks, viewport);
			const top = rowTop(placement.rowIndex, projection) - viewport.scrollTop;
			ctx.strokeStyle = COLORS.hover;
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
		ctx.strokeStyle = COLORS.playhead;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, viewport.height);
		ctx.stroke();
	}
}
