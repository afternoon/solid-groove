import { onCleanup } from "solid-js";
import type { ArrangementShell, DirtyLayer } from "./arrangementShell";
import {
	type DrawEnvironment,
	drawBackgroundLayer,
	drawContentLayer,
	drawInteractionLayer,
	type InteractionState,
} from "./canvasRenderer";
import type { Viewport } from "./geometry";
import type { ArrangementProjection } from "./projection";
import type { WaveformCache } from "./waveformCache";

/**
 * The imperative canvas lifecycle behind `ArrangementView` (PRD ARR-01,
 * section 9.3): frame scheduling, device-pixel-ratio sizing of the three
 * stacked layer canvases, per-layer dirty dispatch, and viewport resize
 * observation.
 *
 * This is deliberately a hook rather than a pure module. Every piece of it is
 * bound to real DOM objects — a `CanvasRenderingContext2D`, a canvas backing
 * store, `requestAnimationFrame`, `ResizeObserver` — and its whole job is to
 * own their lifetimes and tear them down on unmount. Splitting it into
 * "pure" helpers would only relocate that coupling, not remove it.
 *
 * The PRD 9.3 drawing contract it upholds:
 *
 * - **at most one draw per animation frame** — `scheduleDraw` coalesces any
 *   number of dirty marks arriving within a frame into a single callback, and
 *   is a no-op while a frame is already pending;
 * - **each layer redrawn only for its own dirty reason** — `drawDirtyLayers`
 *   drains the shell's dirty set and draws exactly those layers, so a playhead
 *   move touches only the interaction canvas;
 * - **idle when nothing is dirty** — an empty dirty set returns before
 *   touching a context, and no frame is ever scheduled speculatively, so a
 *   stopped transport runs no permanent 60 Hz loop.
 */

/** Everything the canvas lifecycle needs from the component that hosts it. */
export interface ArrangementCanvasOptions {
	/** The live shell, or `null` before `onMount` has created it. */
	readonly shell: () => ArrangementShell | null;
	/** The current projection to draw. */
	readonly projection: () => ArrangementProjection;
	/** The three stacked layer canvases, in z-order. */
	readonly canvases: () => ArrangementLayerCanvases;
	/** Playhead/selection/hover state for the interaction layer. */
	readonly interactionState: () => InteractionState;
	/** The shared waveform cache the content layer draws from. */
	readonly waveformCache: WaveformCache;
}

/** The three stacked, dirty-tracked layer canvases, in z-order. */
export interface ArrangementLayerCanvases {
	readonly background: HTMLCanvasElement;
	readonly content: HTMLCanvasElement;
	readonly interaction: HTMLCanvasElement;
}

export interface ArrangementCanvas {
	/** Requests a draw on the next animation frame. Idempotent within a frame:
	 * marking three layers dirty still produces exactly one draw. */
	readonly scheduleDraw: () => void;
	/** Draws exactly the layers marked dirty since the last frame, sizing the
	 * backing stores first. Exposed for the initial paint and for tests. */
	readonly drawDirtyLayers: () => void;
	/** Observes `element` and pushes its content-box size onto the shell, so
	 * the canvases follow the native scroll viewport. Returns whether an
	 * observer was installed (a non-browser test host has none). */
	readonly observeViewport: (element: Element, onResize: () => void) => boolean;
}

function hostDevicePixelRatio(): number {
	return typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
}

export function useArrangementCanvas(
	options: ArrangementCanvasOptions,
): ArrangementCanvas {
	let rafHandle: number | null = null;

	function scheduleDraw(): void {
		if (rafHandle !== null) return;
		rafHandle =
			typeof requestAnimationFrame === "function"
				? requestAnimationFrame(() => {
						rafHandle = null;
						drawDirtyLayers();
					})
				: (setTimeout(() => {
						rafHandle = null;
						drawDirtyLayers();
					}, 16) as unknown as number);
	}

	function cancelScheduledDraw(): void {
		if (rafHandle === null) return;
		if (typeof cancelAnimationFrame === "function")
			cancelAnimationFrame(rafHandle);
		else clearTimeout(rafHandle);
		rafHandle = null;
	}

	/** Matches the canvas backing store to the viewport at the shell's capped
	 * device pixel ratio, leaving the CSS box at logical size. Only assigns
	 * `width`/`height` on an actual change — writing either clears the canvas. */
	function sizeCanvas(canvas: HTMLCanvasElement, port: Viewport): void {
		const ratio =
			options.shell()?.devicePixelRatio(hostDevicePixelRatio()) ?? 1;
		const targetWidth = Math.round(port.width * ratio);
		const targetHeight = Math.round(port.height * ratio);
		if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
			canvas.width = targetWidth;
			canvas.height = targetHeight;
		}
		canvas.style.width = `${port.width}px`;
		canvas.style.height = `${port.height}px`;
	}

	/** The per-draw environment for one layer: a DPR-scaled 2D context plus the
	 * culling ranges the renderer draws within. `null` when there is no shell
	 * yet or the host cannot give us a 2D context. */
	function drawEnv(canvas: HTMLCanvasElement): DrawEnvironment | null {
		const shell = options.shell();
		if (!shell) return null;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		const port = shell.getViewport();
		const ratio = shell.devicePixelRatio(hostDevicePixelRatio());
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		return {
			ctx,
			viewport: port,
			projection: options.projection(),
			rowRange: shell.rowRange(),
			tickRange: shell.tickRange(),
			waveformCache: options.waveformCache,
		};
	}

	/** Draws exactly the layers marked dirty since the last frame. A playhead
	 * move touches only the interaction canvas (PRD 9.3 dirty reasons). */
	function drawDirtyLayers(): void {
		const shell = options.shell();
		if (!shell) return;
		const layers: ReadonlySet<DirtyLayer> = shell.takeDirty();
		if (layers.size === 0) return;
		const port = shell.getViewport();
		const canvases = options.canvases();
		for (const canvas of [
			canvases.background,
			canvases.content,
			canvases.interaction,
		]) {
			sizeCanvas(canvas, port);
		}
		if (layers.has("background")) {
			const env = drawEnv(canvases.background);
			if (env) drawBackgroundLayer(env);
		}
		if (layers.has("content")) {
			const env = drawEnv(canvases.content);
			if (env) drawContentLayer(env);
		}
		if (layers.has("interaction")) {
			const env = drawEnv(canvases.interaction);
			if (env) drawInteractionLayer(env, options.interactionState());
		}
	}

	/** Resize / DPR: the native scroll viewport's own rect drives canvas size.
	 * Every supported browser has `ResizeObserver`; guarded only so a
	 * non-browser test host (jsdom, which has no `ResizeObserver`) can still
	 * render the shell. */
	function observeViewport(element: Element, onResize: () => void): boolean {
		if (typeof ResizeObserver !== "function") return false;
		const resizeObserver = new ResizeObserver(() => {
			const rect = element.getBoundingClientRect();
			options.shell()?.resize(rect.width, rect.height);
			onResize();
		});
		resizeObserver.observe(element);
		onCleanup(() => resizeObserver.disconnect());
		return true;
	}

	onCleanup(() => {
		cancelScheduledDraw();
	});

	return { scheduleDraw, drawDirtyLayers, observeViewport };
}
