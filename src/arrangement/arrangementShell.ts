/**
 * The framework-free arrangement editor shell controller (`ARR-001`; PRD
 * ARR-01, section 9.3).
 *
 * This is the production successor to the FND-008 spike's ad-hoc component
 * state (`spike/ArrangementSpike.tsx`), lifted out of SolidJS so the shell's
 * behavior — viewport transform, dirty-layer bookkeeping, culling ranges,
 * pointer-anchored zoom, scrollbar/resize/DPR synchronization, playhead-follow,
 * bar-range selection, and the named accessibility actions — is unit-testable
 * without a DOM, a Canvas, or a reactive runtime. `ArrangementView.tsx` is the
 * thin Solid adapter that installs canvases and DOM controls on top of it.
 *
 * It holds no domain state and issues no commands: it consumes a read-only
 * `ArrangementProjection` and reports what to draw. Placement editing
 * (`ARR-002`), sections (`ARR-003`), and automation editing (`ARR-004`) build
 * their transient gestures on top of this shell.
 */

import type { PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import {
	pixelsToTicks,
	type RowRange,
	rowIndexAtOffset,
	type TickRange,
	type Viewport,
	visibleRowRange,
	visibleTickRange,
	zoomAtAnchor,
} from "./geometry";
import { type ArrangementProjection, hitTestArrangement } from "./projection";

/** The three stacked canvases, each with its own dirty reason (PRD 9.3). */
export type DirtyLayer = "background" | "content" | "interaction";

/** A bar-range selection on one track: the ARR-01 "select a bar range". */
export interface ArrangementSelection {
	readonly trackId: TrackId;
	readonly startTick: number;
	readonly endTick: number;
}

export interface ArrangementShellConfig {
	/** CSS pixels of overscan applied to the visible tick range for culling. */
	readonly overscanPx: number;
	/** Rows of overscan applied to the visible row range for header windowing. */
	readonly overscanRows: number;
	readonly minPixelsPerTick: number;
	readonly maxPixelsPerTick: number;
	/** Resize-handle hit width in CSS pixels (constant regardless of zoom). */
	readonly resizeHandlePx: number;
	/** Device-pixel-ratio cap for canvas backing stores (PRD 9.3: capped at 2). */
	readonly maxDevicePixelRatio: number;
}

export const DEFAULT_SHELL_CONFIG: ArrangementShellConfig = {
	overscanPx: 200,
	overscanRows: 4,
	minPixelsPerTick: 0.01,
	maxPixelsPerTick: 2,
	resizeHandlePx: 6,
	maxDevicePixelRatio: 2,
};

export interface ArrangementShellState {
	readonly viewport: Viewport;
	readonly selection: ArrangementSelection | null;
	readonly playheadTicks: number;
	readonly hoverPlacementId: PlacementId | null;
	/** Whether the playhead is kept in view as it advances (PRD 9.3 follow). */
	readonly playheadFollow: boolean;
}

/** How far the pointer moved in CSS pixels; sign follows scroll direction. */
export interface WheelInput {
	readonly deltaX: number;
	readonly deltaY: number;
	/** ctrl/cmd held: the desktop convention for pinch-zoom over the timeline. */
	readonly zoom: boolean;
	/** Viewport-local x the zoom must stay anchored to. */
	readonly anchorX: number;
}

const KEYBOARD_ZOOM_STEP = 1.25;

/**
 * Constructs the shell controller for one open arrangement. Callers subscribe
 * to layer invalidations through `onDirty` and read `getState()`/derived
 * ranges; every mutator marks exactly the layers whose pixels changed, so a
 * playhead advance never invalidates the grid or clip content (PRD 9.3
 * "explicit dirty reasons").
 */
export function createArrangementShell(
	getProjection: () => ArrangementProjection,
	options: {
		readonly initialViewport: Viewport;
		readonly config?: Partial<ArrangementShellConfig>;
		/** Notified with the set of layers that became dirty since last drawn. */
		readonly onDirty: (layers: ReadonlySet<DirtyLayer>) => void;
	},
) {
	const config: ArrangementShellConfig = {
		...DEFAULT_SHELL_CONFIG,
		...options.config,
	};

	let viewport = options.initialViewport;
	let selection: ArrangementSelection | null = null;
	let playheadTicks = 0;
	let hoverPlacementId: PlacementId | null = null;
	let playheadFollow = true;

	const dirty = new Set<DirtyLayer>();

	function markDirty(...layers: DirtyLayer[]): void {
		for (const layer of layers) dirty.add(layer);
		options.onDirty(dirty);
	}

	/** Drains the accumulated dirty set — the renderer calls this once per
	 * animation frame and draws exactly the layers it returns. */
	function takeDirty(): Set<DirtyLayer> {
		const drained = new Set(dirty);
		dirty.clear();
		return drained;
	}

	function totalHeight(): number {
		const offsets = getProjection().rowOffsets;
		return offsets[offsets.length - 1] ?? 0;
	}

	function maxScrollLeft(): number {
		return Math.max(
			0,
			getProjection().lengthTicks * viewport.pixelsPerTick - viewport.width,
		);
	}

	function maxScrollTop(): number {
		return Math.max(0, totalHeight() - viewport.height);
	}

	function clampScrollLeft(value: number): number {
		return Math.max(0, Math.min(maxScrollLeft(), value));
	}

	function clampScrollTop(value: number): number {
		return Math.max(0, Math.min(maxScrollTop(), value));
	}

	function setViewport(next: Viewport): void {
		viewport = next;
	}

	/** The tick range to cull to: only visible content plus a small overscan. */
	function tickRange(): TickRange {
		return visibleTickRange(viewport, config.overscanPx);
	}

	/** The row range to draw / window headers to: visible rows plus overscan. */
	function rowRange(): RowRange {
		return visibleRowRange(
			getProjection().rowOffsets,
			viewport,
			config.overscanRows,
		);
	}

	function devicePixelRatio(hostRatio: number): number {
		return Math.min(config.maxDevicePixelRatio, Math.max(1, hostRatio || 1));
	}

	function setScroll(scrollLeft: number, scrollTop: number): void {
		const nextLeft = clampScrollLeft(scrollLeft);
		const nextTop = clampScrollTop(scrollTop);
		if (nextLeft === viewport.scrollLeft && nextTop === viewport.scrollTop) {
			return;
		}
		setViewport({ ...viewport, scrollLeft: nextLeft, scrollTop: nextTop });
		markDirty("background", "content", "interaction");
	}

	/** Resize / DPR change: canvases resize, everything redraws. Idempotent —
	 * an identical size marks nothing dirty (PRD 9.3 "idle when no pixels
	 * change"). */
	function resize(width: number, height: number): void {
		const nextWidth = Math.max(0, Math.round(width));
		const nextHeight = Math.max(0, Math.round(height));
		if (nextWidth === viewport.width && nextHeight === viewport.height) return;
		// Apply the new dimensions first, so the scroll clamp is computed against
		// the new viewport size — a taller viewport can reveal content that was
		// scrolled past and must pull scrollTop back down.
		setViewport({ ...viewport, width: nextWidth, height: nextHeight });
		setViewport({
			...viewport,
			scrollLeft: clampScrollLeft(viewport.scrollLeft),
			scrollTop: clampScrollTop(viewport.scrollTop),
		});
		markDirty("background", "content", "interaction");
	}

	function zoomAt(anchorX: number, nextPixelsPerTick: number): void {
		const clamped = Math.max(
			config.minPixelsPerTick,
			Math.min(config.maxPixelsPerTick, nextPixelsPerTick),
		);
		if (clamped === viewport.pixelsPerTick) return;
		const result = zoomAtAnchor({
			viewport,
			nextPixelsPerTick: clamped,
			anchorX,
		});
		setViewport({
			...viewport,
			pixelsPerTick: result.pixelsPerTick,
			scrollLeft: clampScrollLeft(result.scrollLeft),
		});
		markDirty("background", "content", "interaction");
	}

	/** Keyboard zoom-in, anchored at the viewport centre. */
	function zoomIn(): void {
		zoomAt(viewport.width / 2, viewport.pixelsPerTick * KEYBOARD_ZOOM_STEP);
	}

	function zoomOut(): void {
		zoomAt(viewport.width / 2, viewport.pixelsPerTick / KEYBOARD_ZOOM_STEP);
	}

	/**
	 * Fit the current bar-range selection to the viewport (KEY-01
	 * `view.zoom_to_selection`). Chooses the zoom that makes the selection span
	 * the viewport width, then scrolls its start to the left edge.
	 */
	function zoomToSelection(): void {
		if (!selection) return;
		const spanTicks = Math.max(1, selection.endTick - selection.startTick);
		const target = viewport.width / (spanTicks * viewport.pixelsPerTick);
		const nextPixelsPerTick = Math.max(
			config.minPixelsPerTick,
			Math.min(config.maxPixelsPerTick, viewport.pixelsPerTick * target),
		);
		setViewport({ ...viewport, pixelsPerTick: nextPixelsPerTick });
		const scrollLeft = clampScrollLeft(selection.startTick * nextPixelsPerTick);
		setViewport({ ...viewport, scrollLeft });
		markDirty("background", "content", "interaction");
	}

	/** Scroll horizontally so the playhead is in view (KEY-01 follow / the
	 * "scroll to playhead" named action). Vertical scroll is unaffected. */
	function scrollToPlayhead(): void {
		const x = playheadTicks * viewport.pixelsPerTick;
		let nextLeft = viewport.scrollLeft;
		if (x < viewport.scrollLeft) {
			nextLeft = x;
		} else if (x > viewport.scrollLeft + viewport.width) {
			nextLeft = x - viewport.width;
		} else {
			return;
		}
		setScroll(nextLeft, viewport.scrollTop);
	}

	function seekTo(ticks: number): void {
		const next = Math.max(0, ticks);
		if (next === playheadTicks) return;
		playheadTicks = next;
		markDirty("interaction");
		if (playheadFollow) scrollToPlayhead();
	}

	function setPlayheadFollow(follow: boolean): void {
		playheadFollow = follow;
	}

	function setSelection(next: ArrangementSelection | null): void {
		selection = next;
		markDirty("interaction");
	}

	function setHover(placementId: PlacementId | null): void {
		if (placementId === hoverPlacementId) return;
		hoverPlacementId = placementId;
		markDirty("interaction");
	}

	function handleWheel(input: WheelInput): void {
		if (input.zoom) {
			const zoomFactor = Math.exp(-input.deltaY * 0.01);
			zoomAt(input.anchorX, viewport.pixelsPerTick * zoomFactor);
		} else {
			setScroll(
				viewport.scrollLeft + input.deltaX,
				viewport.scrollTop + input.deltaY,
			);
		}
	}

	/** Viewport-local pixel -> {rowIndex, tick} through the same transforms the
	 * renderer draws with, so pointer and pixels never disagree (PRD 9.3). */
	function pointToArrangement(localX: number, localY: number) {
		const tick = pixelsToTicks(viewport.scrollLeft + localX, viewport);
		const rowIndex = rowIndexAtOffset(
			getProjection().rowOffsets,
			viewport.scrollTop + localY,
		);
		return { tick, rowIndex };
	}

	function hitTestAt(localX: number, localY: number) {
		const { tick, rowIndex } = pointToArrangement(localX, localY);
		const handleWidthTicks = pixelsToTicks(config.resizeHandlePx, viewport);
		return hitTestArrangement(
			getProjection(),
			{ rowIndex, tick },
			handleWidthTicks,
		);
	}

	/** Pointer hover: hit-test the visible track and light up a placement. */
	function handlePointerMove(localX: number, localY: number): void {
		const result = hitTestAt(localX, localY);
		setHover(result.kind === "placement" ? result.placementId : null);
	}

	/**
	 * Pointer down: select a one-bar range on the pointed track, snapped to the
	 * bar (PRD ARR-01 "clip placements snap to bars by default"). Returns the
	 * new selection so a caller can move a DOM focus proxy to it.
	 */
	function handlePointerDown(
		localX: number,
		localY: number,
	): ArrangementSelection | null {
		const { tick, rowIndex } = pointToArrangement(localX, localY);
		const track = getProjection().tracks[rowIndex];
		if (!track) return null;
		const startTick = Math.max(
			0,
			Math.floor(tick / TICKS_PER_BAR) * TICKS_PER_BAR,
		);
		const next: ArrangementSelection = {
			trackId: track.id,
			startTick,
			endTick: startTick + TICKS_PER_BAR,
		};
		setSelection(next);
		return next;
	}

	function clearHover(): void {
		setHover(null);
	}

	function getState(): ArrangementShellState {
		return {
			viewport,
			selection,
			playheadTicks,
			hoverPlacementId,
			playheadFollow,
		};
	}

	/** Everything changed (project identity / track count): redraw all layers,
	 * re-clamping scroll to the new content bounds. */
	function invalidateAll(): void {
		setViewport({
			...viewport,
			scrollLeft: clampScrollLeft(viewport.scrollLeft),
			scrollTop: clampScrollTop(viewport.scrollTop),
		});
		markDirty("background", "content", "interaction");
	}

	return {
		config,
		getState,
		getViewport: () => viewport,
		tickRange,
		rowRange,
		devicePixelRatio,
		takeDirty,
		markDirty,
		setScroll,
		resize,
		zoomAt,
		zoomIn,
		zoomOut,
		zoomToSelection,
		scrollToPlayhead,
		seekTo,
		setPlayheadFollow,
		setSelection,
		setHover,
		clearHover,
		handleWheel,
		handlePointerMove,
		handlePointerDown,
		hitTestAt,
		pointToArrangement,
		invalidateAll,
	};
}

export type ArrangementShell = ReturnType<typeof createArrangementShell>;
