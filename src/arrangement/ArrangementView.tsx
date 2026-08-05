import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import type { Project } from "../domain/entities";
import { TICKS_PER_BAR } from "../domain/time";
import { ArrangementToolbar } from "./ArrangementToolbar";
import {
	type ArrangementShell,
	createArrangementShell,
} from "./arrangementShell";
import {
	createArrangementWaveformCache,
	type InteractionState,
	RULER_HEIGHT_PX,
} from "./canvasRenderer";
import type { RowMetrics, Viewport } from "./geometry";
import {
	type ArrangementProjection,
	buildArrangementProjection,
} from "./projection";
import { useArrangementCanvas } from "./useArrangementCanvas";
import "./ArrangementView.css";

/**
 * The production arrangement editor shell (`ARR-001`; PRD ARR-01, section 9.3).
 *
 * A hybrid DOM + Canvas 2D surface built on the retained FND-008 renderer
 * contracts and the framework-free `ArrangementShell` controller. It provides:
 *
 * - three stacked, dirty-tracked, viewport-sized canvas layers (background grid
 *   + ruler, content clips, interaction playhead/selection/hover), each redrawn
 *   only for its own dirty reason and never on a permanent animation loop;
 * - a native scroll container with a logical-size spacer, so scrollbars,
 *   trackpads, and assistive tech keep browser-native behavior, and canvas
 *   backing stores that resize only on viewport/DPR change (DPR capped at 2);
 * - virtualized DOM track headers windowed to the visible rows, sharing the
 *   shell's row metrics and scroll;
 * - a transport-driven playhead that follows during playback, and a bar-range
 *   selection overlay;
 * - named DOM actions (zoom in/out, zoom to selection, scroll to playhead) and
 *   an accessible, virtualized track/selection list, so canvas pixels are never
 *   the sole representation of state (PRD 9.3 accessibility).
 *
 * Placement create/move/resize editing (`ARR-002`), section editing
 * (`ARR-003`), and automation editing (`ARR-004`) build their transient
 * gestures on this shell.
 */

/** Uniform per-row sizing. Header height equals the canvas row height so the
 * windowed header column lines up pixel-for-pixel with the timeline. */
export const ROW_METRICS: RowMetrics = {
	trackHeightPx: 28,
	headerHeightPx: 28,
};

const HEADER_WIDTH_PX = 160;
const INITIAL_PIXELS_PER_TICK = 0.08;

export interface ArrangementViewProps {
	readonly project: Project;
	/** Live playhead position in ticks (from the transport). */
	readonly playheadTicks?: Accessor<number>;
	/** Whether the transport is playing, so the playhead follows only then. */
	readonly isPlaying?: Accessor<boolean>;
	readonly analytics?: Analytics;
}

export default function ArrangementView(props: ArrangementViewProps) {
	const analytics = () => props.analytics ?? defaultAnalytics;

	const projection = createMemo<ArrangementProjection>(() =>
		buildArrangementProjection(props.project, ROW_METRICS),
	);

	// A tiny signal bumped whenever the shell mutates viewport/selection state,
	// so the reactive header column and accessible list re-read the shell.
	const [stateVersion, setStateVersion] = createSignal(0);

	let scrollEl!: HTMLDivElement;
	let headerListEl!: HTMLUListElement;
	let backgroundCanvas!: HTMLCanvasElement;
	let contentCanvas!: HTMLCanvasElement;
	let interactionCanvas!: HTMLCanvasElement;

	const waveformCache = createArrangementWaveformCache();
	let shell: ArrangementShell | null = null;
	let firstUseLogged = false;

	function initialViewport(): Viewport {
		return {
			scrollLeft: 0,
			scrollTop: 0,
			width: 960,
			height: 480,
			pixelsPerTick: INITIAL_PIXELS_PER_TICK,
		};
	}

	function interactionState(): InteractionState {
		const state = shell?.getState();
		return {
			playheadTicks: state?.playheadTicks ?? null,
			selection: state?.selection ?? null,
			hoverPlacementId: state?.hoverPlacementId ?? null,
		};
	}

	// The canvas lifecycle — frame scheduling, DPR sizing, per-layer dirty
	// dispatch, resize observation — lives in `useArrangementCanvas`. The shell
	// and the canvas refs are read through accessors because both are assigned
	// during render/mount, after this call.
	const canvas = useArrangementCanvas({
		shell: () => shell,
		projection: () => projection(),
		canvases: () => ({
			background: backgroundCanvas,
			content: contentCanvas,
			interaction: interactionCanvas,
		}),
		interactionState,
		waveformCache,
	});

	/** One arrangement interaction the user initiated: the once-per-account
	 * `feature_first_use` for `arrangement` (PRD OPS-02). */
	function noteFirstUse(): void {
		if (firstUseLogged) return;
		firstUseLogged = analytics().logFeatureFirstUse("arrangement");
	}

	function bumpState(): void {
		setStateVersion((value) => value + 1);
	}

	onMount(() => {
		shell = createArrangementShell(() => projection(), {
			initialViewport: initialViewport(),
			config: { maxDevicePixelRatio: 2 },
			onDirty: () => canvas.scheduleDraw(),
		});

		canvas.observeViewport(scrollEl, bumpState);

		// Prime the initial size and paint every layer once.
		const rect = scrollEl.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			shell.resize(rect.width, rect.height);
		} else {
			shell.markDirty("background", "content", "interaction");
		}
		bumpState();
	});

	// Project identity / structure changed: everything is dirty, scroll bounds
	// re-clamp. The projection memo makes this reactive to any project change,
	// but an unrelated edit still only re-runs the cheap projection build, and a
	// no-op reconcile (same object) means the shell re-clamps to unchanged
	// bounds and redraws once.
	createEffect(() => {
		projection();
		shell?.invalidateAll();
		syncSpacer();
		bumpState();
	});

	// Transport playhead follow: seek the shell to the live position while
	// playing. `seekTo` only marks the interaction layer dirty and follows the
	// playhead into view; a stopped transport advances nothing, so the surface
	// stays idle (PRD 9.3 "must not run a permanent 60 Hz loop while stopped").
	createEffect(() => {
		const ticks = props.playheadTicks?.() ?? 0;
		const playing = props.isPlaying?.() ?? false;
		if (!shell) return;
		shell.setPlayheadFollow(playing);
		shell.seekTo(ticks);
	});

	function syncSpacer(): void {
		if (!shell) return;
		const port = shell.getViewport();
		const proj = projection();
		const logicalWidth = proj.lengthTicks * port.pixelsPerTick;
		const logicalHeight =
			(proj.rowOffsets[proj.rowOffsets.length - 1] ?? 0) + RULER_HEIGHT_PX;
		if (scrollEl) {
			spacerWidth = Math.max(logicalWidth, port.width);
			spacerHeight = Math.max(logicalHeight, port.height);
			setSpacerSignal((value) => value + 1);
		}
	}

	let spacerWidth = 0;
	let spacerHeight = 0;
	const [spacerSignal, setSpacerSignal] = createSignal(0);
	const spacerStyle = createMemo(() => {
		spacerSignal();
		return { width: `${spacerWidth}px`, height: `${spacerHeight}px` };
	});

	// --- Native scroll → shell (scrollbar synchronization) --------------------
	function handleScroll(): void {
		if (!shell) return;
		shell.setScroll(scrollEl.scrollLeft, scrollEl.scrollTop);
		bumpState();
	}

	// --- Wheel: plain scroll is native; ctrl/cmd-wheel zooms anchored ---------
	function handleWheel(event: WheelEvent): void {
		if (!shell) return;
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			const rect = scrollEl.getBoundingClientRect();
			shell.handleWheel({
				deltaX: 0,
				deltaY: event.deltaY,
				zoom: true,
				anchorX: event.clientX - rect.left,
			});
			syncSpacer();
			syncScrollElToShell();
			bumpState();
			noteFirstUse();
		}
		// Non-zoom wheel falls through to the browser's native scroll, which
		// fires `scroll` and drives the shell through `handleScroll`.
	}

	/** After a zoom (which the shell computes), push the shell's scrollLeft back
	 * onto the native scroll element so its scrollbar stays synchronized. */
	function syncScrollElToShell(): void {
		if (!shell || !scrollEl) return;
		const port = shell.getViewport();
		if (scrollEl.scrollLeft !== port.scrollLeft) {
			scrollEl.scrollLeft = port.scrollLeft;
		}
		if (scrollEl.scrollTop !== port.scrollTop) {
			scrollEl.scrollTop = port.scrollTop;
		}
	}

	// --- Pointer over the interaction canvas ----------------------------------
	function localPoint(event: PointerEvent): { x: number; y: number } {
		const rect = interactionCanvas.getBoundingClientRect();
		// The ruler occupies the top strip and does not host rows.
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top - RULER_HEIGHT_PX,
		};
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!shell) return;
		const { x, y } = localPoint(event);
		if (y < 0) {
			shell.clearHover();
			return;
		}
		shell.handlePointerMove(x, y);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!shell) return;
		const { x, y } = localPoint(event);
		if (y < 0) return;
		const selection = shell.handlePointerDown(x, y);
		bumpState();
		if (selection) noteFirstUse();
	}

	// --- Named DOM actions (also the keyboard/accessibility equivalents) ------
	function zoomIn(): void {
		shell?.zoomIn();
		syncSpacer();
		syncScrollElToShell();
		bumpState();
		noteFirstUse();
	}
	function zoomOut(): void {
		shell?.zoomOut();
		syncSpacer();
		syncScrollElToShell();
		bumpState();
		noteFirstUse();
	}
	function zoomToSelection(): void {
		shell?.zoomToSelection();
		syncSpacer();
		syncScrollElToShell();
		bumpState();
		noteFirstUse();
	}
	function scrollToPlayhead(): void {
		shell?.scrollToPlayhead();
		syncScrollElToShell();
		bumpState();
		noteFirstUse();
	}

	/** Select an entire track's first bar from the accessible list, for a
	 * keyboard-only user who never touches the canvas (PRD 9.3: "Keyboard
	 * navigation updates selection through the same model as pointer hit
	 * testing"). */
	function selectTrackFromList(rowIndex: number): void {
		if (!shell) return;
		const track = projection().tracks[rowIndex];
		if (!track) return;
		shell.setSelection({
			trackId: track.id,
			startTick: 0,
			endTick: TICKS_PER_BAR,
		});
		bumpState();
		noteFirstUse();
	}

	// The visible window of track rows, recomputed from the shell's row range.
	const headerRows = createMemo(() => {
		stateVersion();
		if (!shell) return [] as ArrangementProjection["tracks"][number][];
		const range = shell.rowRange();
		const tracks = projection().tracks;
		const rows: ArrangementProjection["tracks"][number][] = [];
		for (let index = range.startRow; index <= range.endRow; index += 1) {
			const track = tracks[index];
			if (track) rows.push(track);
		}
		return rows;
	});

	const scrollTopMemo = createMemo(() => {
		stateVersion();
		return shell?.getViewport().scrollTop ?? 0;
	});

	const selectionSummary = createMemo(() => {
		stateVersion();
		const selection = shell?.getState().selection;
		if (!selection) return null;
		const track = projection().tracks.find((t) => t.id === selection.trackId);
		const startBar = Math.floor(selection.startTick / TICKS_PER_BAR) + 1;
		const endBar = Math.ceil(selection.endTick / TICKS_PER_BAR) + 1;
		return { trackName: track?.name ?? "track", startBar, endBar };
	});

	return (
		<div class="arrangement-view" data-testid="arrangement-view-ready">
			<ArrangementToolbar
				onZoomIn={zoomIn}
				onZoomOut={zoomOut}
				onZoomToSelection={zoomToSelection}
				onScrollToPlayhead={scrollToPlayhead}
				hasSelection={selectionSummary() !== null}
			/>
			<div class="arrangement-body">
				<div
					class="arrangement-headers"
					style={{ width: `${HEADER_WIDTH_PX}px` }}
				>
					<div class="arrangement-headers-ruler-spacer" />
					<ul
						class="arrangement-headers-inner"
						ref={headerListEl}
						aria-label="Tracks"
						style={{ transform: `translateY(${-scrollTopMemo()}px)` }}
					>
						<For each={headerRows()}>
							{(track) => (
								<li
									class="arrangement-header-row"
									aria-label={`${track.name}${track.muted ? " (muted)" : ""}`}
									style={{
										position: "absolute",
										top: `${track.rowIndex * ROW_METRICS.headerHeightPx}px`,
										height: `${ROW_METRICS.headerHeightPx}px`,
										width: "100%",
									}}
								>
									<span
										class="arrangement-header-swatch"
										style={{ background: track.color }}
									/>
									<span class="arrangement-header-name">{track.name}</span>
								</li>
							)}
						</For>
					</ul>
				</div>
				<div
					class="arrangement-viewport"
					ref={scrollEl}
					onScroll={handleScroll}
					onWheel={handleWheel}
				>
					{/* Logical-size spacer: gives the native scroll container real,
					    browser-native scrollbars over the whole arrangement, while
					    the canvases below stay viewport-sized and sticky. */}
					<div class="arrangement-spacer" style={spacerStyle()} />
					<div class="arrangement-canvas-stack">
						<canvas class="arrangement-layer" ref={backgroundCanvas} />
						<canvas class="arrangement-layer" ref={contentCanvas} />
						<canvas
							class="arrangement-layer arrangement-layer-interactive"
							ref={interactionCanvas}
							onPointerMove={handlePointerMove}
							onPointerDown={handlePointerDown}
							onPointerLeave={() => shell?.clearHover()}
						/>
					</div>
				</div>
			</div>
			{/* Accessible mirror: the visible tracks and the current selection as
			    real DOM, so assistive tech never has to read canvas pixels. */}
			<div class="visually-hidden">
				<p aria-live="polite" data-testid="arrangement-selection-live">
					<Show when={selectionSummary()} fallback="No selection">
						{(summary) =>
							`Selected ${summary().trackName}, bars ${summary().startBar} to ${summary().endBar}`
						}
					</Show>
				</p>
				<ul aria-label="Arrangement tracks">
					<For each={headerRows()}>
						{(track) => (
							<li>
								<button
									type="button"
									data-track-select={track.id}
									onClick={() => selectTrackFromList(track.rowIndex)}
								>
									{`Select ${track.name}`}
								</button>
							</li>
						)}
					</For>
				</ul>
			</div>
		</div>
	);
}
