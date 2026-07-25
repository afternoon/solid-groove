import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
} from "solid-js";
import type { Project } from "../../domain/entities";
import type { PlacementId, TrackId } from "../../domain/ids";
import {
	pixelsToTicks,
	type RowMetrics,
	rowIndexAtOffset,
	type Viewport,
	visibleRowRange,
	visibleTickRange,
	zoomAtAnchor,
} from "../geometry";
import {
	type ArrangementProjection,
	buildArrangementProjection,
	hitTestArrangement,
} from "../projection";
import {
	createSpikeWaveformCache,
	type DrawEnvironment,
	drawBackgroundLayer,
	drawContentLayer,
	drawInteractionLayer,
	type InteractionState,
} from "./canvasLayers";
import {
	createInstrumentation,
	type DirtyLayer,
	median,
	percentile,
} from "./instrumentation";
import "./ArrangementSpike.css";

/**
 * The FND-008 renderer spike (backlog task; PRD 9.3). Disposable, exploratory
 * UI: it exists to give the measurement harness something representative to
 * drive, not to be grown into the production arrangement editor (`ARR-005`
 * replaces it). See `spike/README.md`. The parts worth keeping —
 * `ArrangementProjection`, the geometry helpers, and the waveform cache — live
 * one directory up in `src/arrangement/`, imported here rather than defined
 * here.
 */

export const ROW_METRICS: RowMetrics = {
	trackHeightPx: 28,
	headerHeightPx: 28,
};
const HEADER_WIDTH_PX = 160;
const OVERSCAN_ROWS = 4;
const OVERSCAN_PX = 200;
const MIN_PIXELS_PER_TICK = 0.01;
const MAX_PIXELS_PER_TICK = 2;
const RESIZE_HANDLE_PX = 6;

export interface ArrangementSpikeProps {
	readonly project: Project;
}

interface Selection {
	readonly trackId: TrackId;
	readonly startTick: number;
	readonly endTick: number;
}

export type TraceName = "scroll" | "zoom" | "seek" | "selection";

export interface TraceResult {
	readonly trace: TraceName;
	readonly frameCount: number;
	/** Wall-clock time between consecutive presented animation frames
	 * (`FrameSample.timestampMs` deltas) — the basis PRD 9.3's frame budget
	 * ("median frame time at or below 16.7 ms, p95 at or below 33 ms") is
	 * stated against. This spans everything that happens between one
	 * rAF-callback invocation and the next: rasterization, compositing, DOM
	 * layout/style for the header column, and Solid's reactive work, none of
	 * which the synchronous draw-call duration below captures. */
	readonly medianFrameMs: number;
	readonly p95FrameMs: number;
	/** Synchronous canvas draw-command issue duration alone (the
	 * `performance.now()` bracket in `drawDirtyLayers`). Useful for isolating
	 * draw-call cost, but it is a strict lower bound on frame cost, not frame
	 * time itself — see `medianFrameMs`/`p95FrameMs`. */
	readonly medianDrawMs: number;
	readonly p95DrawMs: number;
	readonly longTaskCount: number;
	readonly longTaskTotalMs: number;
	readonly redrawCounts: Readonly<Record<DirtyLayer, number>>;
	readonly heapUsedMB: number | null;
}

/** The imperative bridge the Playwright harness drives through
 * `window.__arrangementSpike` (see `perf/arrangement.bench.spec.ts`). Kept
 * separate from Solid's reactive signals: scripted traces need tight control
 * over exactly when a frame happens, which a reactive effect graph does not
 * give you for free. */
export interface ArrangementSpikeHandle {
	getViewport(): Viewport;
	setScroll(scrollLeft: number, scrollTop: number): void;
	zoomAt(anchorX: number, nextPixelsPerTick: number): void;
	seekTo(ticks: number): void;
	select(selection: Selection | null): void;
	runScriptedTrace(trace: TraceName, frames?: number): Promise<TraceResult>;
}

declare global {
	interface Window {
		__arrangementSpike?: ArrangementSpikeHandle;
	}
}

export default function ArrangementSpike(props: ArrangementSpikeProps) {
	const projection = createMemo<ArrangementProjection>(() =>
		buildArrangementProjection(props.project, ROW_METRICS),
	);

	const [viewport, setViewport] = createSignal<Viewport>({
		scrollLeft: 0,
		scrollTop: 0,
		width: 960,
		height: 480,
		pixelsPerTick: 0.08,
	});
	const [selection, setSelection] = createSignal<Selection | null>(null);
	const [playheadTicks, setPlayheadTicks] = createSignal<number | null>(0);
	const [hoverPlacementId, setHoverPlacementId] =
		createSignal<PlacementId | null>(null);
	const [headerRange, setHeaderRange] = createSignal({
		startRow: 0,
		endRow: -1,
	});

	let containerEl!: HTMLDivElement;
	let backgroundCanvas!: HTMLCanvasElement;
	let contentCanvas!: HTMLCanvasElement;
	let interactionCanvas!: HTMLCanvasElement;

	const waveformCache = createSpikeWaveformCache();
	const instrumentation = createInstrumentation();

	const dirtyLayers = new Set<DirtyLayer>();
	let rafHandle: number | null = null;

	function markDirty(...layers: DirtyLayer[]): void {
		for (const layer of layers) dirtyLayers.add(layer);
		scheduleDraw();
	}

	function scheduleDraw(): void {
		if (rafHandle !== null) return;
		rafHandle = requestAnimationFrame(() => {
			rafHandle = null;
			drawDirtyLayers();
		});
	}

	function devicePixelRatioCapped(): number {
		return Math.min(2, window.devicePixelRatio || 1);
	}

	function sizeCanvas(canvas: HTMLCanvasElement, port: Viewport): void {
		const ratio = devicePixelRatioCapped();
		const targetWidth = Math.round(port.width * ratio);
		const targetHeight = Math.round(port.height * ratio);
		if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
			canvas.width = targetWidth;
			canvas.height = targetHeight;
		}
		canvas.style.width = `${port.width}px`;
		canvas.style.height = `${port.height}px`;
	}

	function drawEnv(canvas: HTMLCanvasElement): DrawEnvironment {
		const port = viewport();
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2D canvas context unavailable");
		const ratio = devicePixelRatioCapped();
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		return {
			ctx,
			viewport: port,
			projection: projection(),
			rowRange: visibleRowRange(projection().rowOffsets, port, OVERSCAN_ROWS),
			tickRange: visibleTickRange(port, OVERSCAN_PX),
			waveformCache,
		};
	}

	function interactionState(): InteractionState {
		return {
			playheadTicks: playheadTicks(),
			selection: selection(),
			hoverPlacementId: hoverPlacementId(),
		};
	}

	/** Draws exactly the layers marked dirty, then clears the flag set — the
	 * PRD 9.3 "explicit dirty reasons" model: a playhead move never touches
	 * the background or content canvases. */
	function drawDirtyLayers(): void {
		if (dirtyLayers.size === 0) return;
		const start = performance.now();
		const layers = [...dirtyLayers];
		dirtyLayers.clear();

		const port = viewport();
		for (const canvas of [backgroundCanvas, contentCanvas, interactionCanvas]) {
			sizeCanvas(canvas, port);
		}
		if (layers.includes("background"))
			drawBackgroundLayer(drawEnv(backgroundCanvas));
		if (layers.includes("content")) drawContentLayer(drawEnv(contentCanvas));
		if (layers.includes("interaction")) {
			drawInteractionLayer(drawEnv(interactionCanvas), interactionState());
		}
		instrumentation.recordRedraw(layers, performance.now() - start);
	}

	function updateHeaderRange(): void {
		setHeaderRange(
			visibleRowRange(projection().rowOffsets, viewport(), OVERSCAN_ROWS),
		);
	}

	function applyViewport(next: Partial<Viewport>): void {
		setViewport((current) => ({ ...current, ...next }));
		updateHeaderRange();
	}

	function setScroll(scrollLeft: number, scrollTop: number): void {
		const port = viewport();
		const totalHeight =
			projection().rowOffsets[projection().rowOffsets.length - 1];
		const maxScrollLeft = Math.max(
			0,
			projection().lengthTicks * port.pixelsPerTick - port.width,
		);
		const maxScrollTop = Math.max(0, totalHeight - port.height);
		applyViewport({
			scrollLeft: Math.max(0, Math.min(maxScrollLeft, scrollLeft)),
			scrollTop: Math.max(0, Math.min(maxScrollTop, scrollTop)),
		});
		markDirty("background", "content", "interaction");
	}

	function zoomAt(anchorX: number, nextPixelsPerTick: number): void {
		const clamped = Math.max(
			MIN_PIXELS_PER_TICK,
			Math.min(MAX_PIXELS_PER_TICK, nextPixelsPerTick),
		);
		const result = zoomAtAnchor({
			viewport: viewport(),
			nextPixelsPerTick: clamped,
			anchorX,
		});
		applyViewport(result);
		markDirty("background", "content", "interaction");
	}

	function seekTo(ticks: number): void {
		setPlayheadTicks(Math.max(0, ticks));
		markDirty("interaction");
	}

	function select(next: Selection | null): void {
		setSelection(next);
		markDirty("interaction");
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		if (event.ctrlKey || event.metaKey) {
			const port = viewport();
			const rect = interactionCanvas.getBoundingClientRect();
			const anchorX = event.clientX - rect.left;
			const zoomFactor = Math.exp(-event.deltaY * 0.01);
			zoomAt(anchorX, port.pixelsPerTick * zoomFactor);
		} else {
			const port = viewport();
			setScroll(port.scrollLeft + event.deltaX, port.scrollTop + event.deltaY);
		}
	}

	function pointToHitTest(clientX: number, clientY: number) {
		const rect = interactionCanvas.getBoundingClientRect();
		const port = viewport();
		const localX = clientX - rect.left;
		const localY = clientY - rect.top;
		const tick = pixelsToTicks(port.scrollLeft + localX, port);
		const rowIndex = rowIndexAtOffset(
			projection().rowOffsets,
			port.scrollTop + localY,
		);
		const handleWidthTicks = pixelsToTicks(RESIZE_HANDLE_PX, port);
		return { tick, rowIndex, handleWidthTicks };
	}

	function handlePointerMove(event: PointerEvent): void {
		const { tick, rowIndex, handleWidthTicks } = pointToHitTest(
			event.clientX,
			event.clientY,
		);
		const result = hitTestArrangement(
			projection(),
			{ rowIndex, tick },
			handleWidthTicks,
		);
		setHoverPlacementId(
			result.kind === "placement" ? result.placementId : null,
		);
		markDirty("interaction");
	}

	function handlePointerDown(event: PointerEvent): void {
		const { tick, rowIndex } = pointToHitTest(event.clientX, event.clientY);
		const track = projection().tracks[rowIndex];
		if (!track) return;
		const barTicks = Math.max(1, Math.round(1 / viewport().pixelsPerTick));
		select({ trackId: track.id, startTick: tick, endTick: tick + barTicks });
	}

	onMount(() => {
		const resizeObserver = new ResizeObserver(() => {
			// `containerEl` (`.arrangement-spike-viewport`) is a flex sibling of
			// the header column (`.arrangement-spike` is `display: flex`), so its
			// own rect already excludes the header width — subtracting
			// `HEADER_WIDTH_PX` again would double-count it.
			const rect = containerEl.getBoundingClientRect();
			applyViewport({
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			});
			markDirty("background", "content", "interaction");
		});
		resizeObserver.observe(containerEl);
		onCleanup(() => resizeObserver.disconnect());

		updateHeaderRange();
		markDirty("background", "content", "interaction");

		const handle: ArrangementSpikeHandle = {
			getViewport: () => viewport(),
			setScroll,
			zoomAt,
			seekTo,
			select,
			runScriptedTrace: (trace, frames) => runScriptedTrace(trace, frames),
		};
		window.__arrangementSpike = handle;
		onCleanup(() => {
			if (window.__arrangementSpike === handle) {
				delete window.__arrangementSpike;
			}
		});
	});

	onCleanup(() => {
		if (rafHandle !== null) cancelAnimationFrame(rafHandle);
		instrumentation.dispose();
	});

	/** Runs one of the four scripted traces the backlog task calls for
	 * (scroll/zoom/seek/selection), driving the same public API a real
	 * pointer/wheel/keyboard gesture would, for `frames` animation frames,
	 * and returns the frame/long-task/redraw/memory numbers collected while
	 * it ran. Called directly by component code (e.g. a dev harness button)
	 * and by the Playwright bench spec via `window.__arrangementSpike`. */
	async function runScriptedTrace(
		trace: TraceName,
		frames = 120,
	): Promise<TraceResult> {
		instrumentation.reset();
		const port = viewport();
		const totalTicks = Math.max(1, projection().lengthTicks);

		for (let frame = 0; frame < frames; frame += 1) {
			const t = frame / frames;
			switch (trace) {
				case "scroll": {
					// Sweep both axes over the trace so track-count comparisons
					// exercise rows past the first screenful, not just the initial
					// ~30 visible rows (row virtualization, header windowing).
					const rowOffsets = projection().rowOffsets;
					const maxScrollTop = Math.max(
						0,
						rowOffsets[rowOffsets.length - 1] - port.height,
					);
					setScroll(
						t * (totalTicks * port.pixelsPerTick * 0.5),
						t * maxScrollTop,
					);
					break;
				}
				case "zoom":
					zoomAt(
						port.width / 2,
						port.pixelsPerTick * (1 + 0.3 * Math.sin(t * Math.PI * 4)),
					);
					break;
				case "seek":
					seekTo(t * totalTicks);
					break;
				case "selection": {
					const track =
						projection().tracks[
							frame % Math.max(1, projection().tracks.length)
						];
					if (track) {
						select({
							trackId: track.id,
							startTick: t * totalTicks,
							endTick: t * totalTicks + 768,
						});
					}
					break;
				}
			}
			await waitForNextFrame();
		}

		const snapshot = instrumentation.snapshot();
		// Frame time is the interval between consecutive presented frames, not
		// how long the synchronous draw call took (see `TraceResult`'s doc
		// comments) — derive it from consecutive `FrameSample.timestampMs`
		// values, which are captured once per rAF callback.
		const frameTimestamps = snapshot.frames.map((f) => f.timestampMs);
		const frameIntervals = frameTimestamps
			.slice(1)
			.map((timestamp, index) => timestamp - frameTimestamps[index]);
		const drawDurations = snapshot.frames.map((f) => f.durationMs);
		const longTaskTotalMs = snapshot.longTasks.reduce(
			(sum, task) => sum + task.durationMs,
			0,
		);
		return {
			trace,
			frameCount: snapshot.frames.length,
			medianFrameMs: frameIntervals.length ? median(frameIntervals) : 0,
			p95FrameMs: frameIntervals.length ? percentile(frameIntervals, 95) : 0,
			medianDrawMs: drawDurations.length ? median(drawDurations) : 0,
			p95DrawMs: drawDurations.length ? percentile(drawDurations, 95) : 0,
			longTaskCount: snapshot.longTasks.length,
			longTaskTotalMs,
			redrawCounts: snapshot.redrawCounts,
			heapUsedMB: snapshot.heapUsedMB,
		};
	}

	function waitForNextFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	const headerRows = createMemo(() => {
		const range = headerRange();
		const tracks = projection().tracks;
		const rows = [];
		for (let index = range.startRow; index <= range.endRow; index += 1) {
			const track = tracks[index];
			if (track) rows.push(track);
		}
		return rows;
	});

	createEffect(() => {
		// Track count / project identity changed: everything is dirty.
		projection();
		markDirty("background", "content", "interaction");
	});

	return (
		<div class="arrangement-spike" data-testid="arrangement-spike-ready">
			<div
				class="arrangement-spike-headers"
				style={{ width: `${HEADER_WIDTH_PX}px` }}
			>
				<ul
					class="arrangement-spike-headers-inner"
					aria-label="Tracks"
					style={{
						transform: `translateY(${-viewport().scrollTop}px)`,
					}}
				>
					<For each={headerRows()}>
						{(track) => (
							<li
								class="arrangement-spike-header-row"
								aria-label={`${track.name}${track.muted ? " (muted)" : ""}`}
								style={{
									position: "absolute",
									top: `${track.rowIndex * ROW_METRICS.headerHeightPx}px`,
									height: `${ROW_METRICS.headerHeightPx}px`,
									width: "100%",
								}}
							>
								<span
									class="arrangement-spike-header-swatch"
									style={{ background: track.color }}
								/>
								<span class="arrangement-spike-header-name">{track.name}</span>
							</li>
						)}
					</For>
				</ul>
			</div>
			<div class="arrangement-spike-viewport" ref={containerEl}>
				<canvas class="arrangement-spike-layer" ref={backgroundCanvas} />
				<canvas class="arrangement-spike-layer" ref={contentCanvas} />
				<canvas
					class="arrangement-spike-layer arrangement-spike-layer-interactive"
					ref={interactionCanvas}
					onWheel={handleWheel}
					onPointerMove={handlePointerMove}
					onPointerDown={handlePointerDown}
					onPointerLeave={() => {
						setHoverPlacementId(null);
						markDirty("interaction");
					}}
				/>
			</div>
		</div>
	);
}
