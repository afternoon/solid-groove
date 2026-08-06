import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createLargeArrangementProject } from "../domain/fixtures";
import {
	type ArrangementShell,
	createArrangementShell,
} from "./arrangementShell";
import { createArrangementWaveformCache } from "./canvasRenderer";
import type { Viewport } from "./geometry";
import { buildArrangementProjection } from "./projection";
import { useArrangementCanvas } from "./useArrangementCanvas";

const ROW_METRICS = { trackHeightPx: 28, headerHeightPx: 28 };

/**
 * jsdom canvases return `null` from `getContext("2d")`, so each layer canvas
 * gets a recording stub. Only the calls the drawing contract is asserted
 * through are needed — this is not a pixel test.
 */
function fakeCanvas(): HTMLCanvasElement & { setTransformCalls: number } {
	const canvas = document.createElement("canvas");
	let setTransformCalls = 0;
	const ctx = new Proxy(
		{},
		{
			get(_target, prop) {
				if (prop === "setTransform") {
					return () => {
						setTransformCalls += 1;
					};
				}
				if (prop === "canvas") return canvas;
				return () => undefined;
			},
			set() {
				return true;
			},
		},
	) as CanvasRenderingContext2D;
	canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
	Object.defineProperty(canvas, "setTransformCalls", {
		get: () => setTransformCalls,
	});
	return canvas as HTMLCanvasElement & { setTransformCalls: number };
}

const INITIAL_VIEWPORT: Viewport = {
	scrollLeft: 0,
	scrollTop: 0,
	width: 960,
	height: 480,
	pixelsPerTick: 0.08,
};

/** Builds a live shell plus the hook wired onto three stub canvases, inside a
 * disposable reactive root so `onCleanup` runs. */
function harness() {
	const projection = buildArrangementProjection(
		createLargeArrangementProject(20),
		ROW_METRICS,
	);
	const canvases = {
		background: fakeCanvas(),
		content: fakeCanvas(),
		interaction: fakeCanvas(),
	};
	let shell: ArrangementShell | null = null;
	let dispose = () => {};
	const canvas = createRoot((disposeRoot) => {
		dispose = disposeRoot;
		return useArrangementCanvas({
			shell: () => shell,
			projection: () => projection,
			canvases: () => canvases,
			interactionState: () => ({
				playheadTicks: 0,
				selection: null,
				hoverPlacementId: null,
				selectedPlacementIds: new Set(),
			}),
			waveformCache: createArrangementWaveformCache(),
		});
	});
	shell = createArrangementShell(() => projection, {
		initialViewport: INITIAL_VIEWPORT,
		config: { maxDevicePixelRatio: 2 },
		onDirty: () => canvas.scheduleDraw(),
	});
	return { canvas, canvases, shell, dispose };
}

describe("useArrangementCanvas drawing contract (PRD 9.3)", () => {
	it("draws at most one frame however many times a layer is marked dirty", async () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		try {
			const { shell, canvases, dispose } = harness();
			shell.markDirty("background");
			shell.markDirty("content");
			shell.markDirty("interaction");
			// Three dirty marks within one frame coalesce into a single request.
			expect(frames.length).toBe(1);

			frames[0]?.(0);
			// All three layers were dirty, so all three drew exactly once.
			expect(canvases.background.setTransformCalls).toBe(1);
			expect(canvases.content.setTransformCalls).toBe(1);
			expect(canvases.interaction.setTransformCalls).toBe(1);
			dispose();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("redraws only the layer whose dirty reason fired", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		try {
			const { shell, canvases, dispose } = harness();
			// A playhead move marks only the interaction layer.
			shell.markDirty("interaction");
			frames[frames.length - 1]?.(0);
			expect(canvases.interaction.setTransformCalls).toBe(1);
			expect(canvases.background.setTransformCalls).toBe(0);
			expect(canvases.content.setTransformCalls).toBe(0);
			dispose();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("stays idle when nothing is dirty, touching neither context nor backing store", () => {
		const { canvas, canvases, dispose } = harness();
		const layers = [
			canvases.background,
			canvases.content,
			canvases.interaction,
		];
		// jsdom's default canvas backing store, before any sizing has happened.
		const defaultWidth = layers[0]?.width;
		const defaultHeight = layers[0]?.height;
		expect(defaultWidth).not.toBe(INITIAL_VIEWPORT.width);

		// No dirty marks at all: a forced draw must return before it draws *or*
		// resizes. Sizing is the observable half — writing `canvas.width` clears
		// the canvas, so an idle frame that still sized would wipe visible pixels.
		canvas.drawDirtyLayers();
		for (const layer of layers) {
			expect(layer.setTransformCalls).toBe(0);
			expect(layer.width).toBe(defaultWidth);
			expect(layer.height).toBe(defaultHeight);
			expect(layer.style.width).toBe("");
		}
		dispose();
	});

	it("sizes each backing store to the viewport at the shell's capped ratio", () => {
		const { canvas, canvases, shell, dispose } = harness();
		shell.markDirty("background", "content", "interaction");
		canvas.drawDirtyLayers();
		// jsdom reports devicePixelRatio 1, and the shell caps at 2.
		for (const layer of [
			canvases.background,
			canvases.content,
			canvases.interaction,
		]) {
			expect(layer.width).toBe(INITIAL_VIEWPORT.width);
			expect(layer.height).toBe(INITIAL_VIEWPORT.height);
			expect(layer.style.width).toBe(`${INITIAL_VIEWPORT.width}px`);
			expect(layer.style.height).toBe(`${INITIAL_VIEWPORT.height}px`);
		}
		dispose();
	});

	it("cancels a pending frame on cleanup, so an unmounted view never draws", () => {
		const frames: FrameRequestCallback[] = [];
		const cancelled: number[] = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			cancelled.push(handle);
		});
		try {
			const { shell, dispose } = harness();
			shell.markDirty("content");
			expect(frames.length).toBe(1);
			dispose();
			expect(cancelled).toEqual([1]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("reports no observer when the host has no ResizeObserver (jsdom)", () => {
		const { canvas, dispose } = harness();
		const installed = canvas.observeViewport(
			document.createElement("div"),
			() => {},
		);
		expect(installed).toBe(typeof ResizeObserver === "function");
		dispose();
	});
});
