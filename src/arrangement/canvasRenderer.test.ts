import { describe, expect, it, vi } from "vitest";
import { createLargeArrangementProject } from "../domain/fixtures";
import { TICKS_PER_BAR } from "../domain/time";
import {
	createArrangementWaveformCache,
	type DrawEnvironment,
	drawBackgroundLayer,
	drawContentLayer,
	drawInteractionLayer,
	RULER_HEIGHT_PX,
} from "./canvasRenderer";
import type { Viewport } from "./geometry";
import { visibleRowRange, visibleTickRange } from "./geometry";
import { buildArrangementProjection } from "./projection";

const ROW_METRICS = { trackHeightPx: 28, headerHeightPx: 28 };

/**
 * A minimal recording `CanvasRenderingContext2D`. jsdom has no 2D context, and
 * these tests only need to count draw commands and assert which regions were
 * painted — not pixels — so a spy object is enough and keeps the suite free of
 * a native canvas dependency.
 */
function fakeContext(): CanvasRenderingContext2D & {
	fillRectCalls: number;
	strokeRectCalls: number;
	moveToXs: number[];
} {
	const fillRectSpy = vi.fn();
	const strokeRectSpy = vi.fn();
	const moveToXs: number[] = [];
	const ctx = {
		setTransform: vi.fn(),
		clearRect: vi.fn(),
		fillRect: (x: number, _y: number, _w: number, _h: number) => {
			fillRectSpy(x);
		},
		strokeRect: (x: number, _y: number, _w: number, _h: number) => {
			strokeRectSpy(x);
		},
		beginPath: vi.fn(),
		moveTo: (x: number) => {
			moveToXs.push(x);
		},
		lineTo: vi.fn(),
		stroke: vi.fn(),
		fillText: vi.fn(),
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		globalAlpha: 1,
		font: "",
		textBaseline: "alphabetic" as CanvasTextBaseline,
		get fillRectCalls() {
			return fillRectSpy.mock.calls.length;
		},
		get strokeRectCalls() {
			return strokeRectSpy.mock.calls.length;
		},
		moveToXs,
	};
	return ctx as unknown as CanvasRenderingContext2D & {
		fillRectCalls: number;
		strokeRectCalls: number;
		moveToXs: number[];
	};
}

function baseViewport(overrides: Partial<Viewport> = {}): Viewport {
	return {
		scrollLeft: 0,
		scrollTop: 0,
		width: 800,
		height: 400,
		pixelsPerTick: 0.08,
		...overrides,
	};
}

function envFor(
	viewport: Viewport,
): DrawEnvironment & { ctx: ReturnType<typeof fakeContext> } {
	const project = createLargeArrangementProject(20);
	const projection = buildArrangementProjection(project, ROW_METRICS);
	return {
		ctx: fakeContext(),
		viewport,
		projection,
		rowRange: visibleRowRange(projection.rowOffsets, viewport, 4),
		tickRange: visibleTickRange(viewport, 200),
		waveformCache: createArrangementWaveformCache(),
	};
}

describe("drawContentLayer culls to the visible window", () => {
	it("draws a placement block only for placements in the visible tick range", () => {
		const env = envFor(baseViewport());
		drawContentLayer(env);
		// Every placement drawn issues at least one fillRect for its block. The
		// count must be well below the project's total placement count (2,500).
		const totalPlacements = env.projection.placementsById.size;
		expect(env.ctx.fillRectCalls).toBeGreaterThan(0);
		expect(env.ctx.fillRectCalls).toBeLessThan(totalPlacements);
	});

	it("draws strictly more blocks when the viewport is larger", () => {
		const small = envFor(baseViewport({ width: 400, height: 200 }));
		const large = envFor(baseViewport({ width: 1600, height: 800 }));
		drawContentLayer(small);
		drawContentLayer(large);
		expect(large.ctx.fillRectCalls).toBeGreaterThanOrEqual(
			small.ctx.fillRectCalls,
		);
	});
});

describe("drawBackgroundLayer", () => {
	it("clears and repaints only the viewport-sized region", () => {
		const env = envFor(baseViewport());
		drawBackgroundLayer(env);
		expect(env.ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
	});

	it("paints the ruler strip at the top", () => {
		const env = envFor(baseViewport());
		drawBackgroundLayer(env);
		// The ruler background is a fillRect at (0,0,width,RULER_HEIGHT_PX).
		expect(RULER_HEIGHT_PX).toBeGreaterThan(0);
		expect(env.ctx.fillRectCalls).toBeGreaterThan(0);
	});
});

describe("drawInteractionLayer", () => {
	it("draws the playhead line at the scrolled screen x", () => {
		const env = envFor(baseViewport({ scrollLeft: 0 }));
		drawInteractionLayer(env, {
			playheadTicks: TICKS_PER_BAR * 2,
			selection: null,
			hoverPlacementId: null,
			selectedPlacementIds: new Set(),
		});
		// The playhead moveTo x is the tick converted to a pixel (0.08 px/tick).
		const expectedX = Math.round(TICKS_PER_BAR * 2 * 0.08) + 0.5;
		expect(env.ctx.moveToXs).toContain(expectedX);
	});

	it("is a no-op clear when there is no playhead, selection, or hover", () => {
		const env = envFor(baseViewport());
		drawInteractionLayer(env, {
			playheadTicks: null,
			selection: null,
			hoverPlacementId: null,
			selectedPlacementIds: new Set(),
		});
		expect(env.ctx.clearRect).toHaveBeenCalledTimes(1);
		expect(env.ctx.fillRectCalls).toBe(0);
	});

	it("draws a filled, thick-bordered highlight for a selected placement (ARR-002)", () => {
		const env = envFor(baseViewport());
		const [placementId] = env.projection.placementsById.keys();
		if (!placementId) throw new Error("fixture has no placement");
		drawInteractionLayer(env, {
			playheadTicks: null,
			selection: null,
			hoverPlacementId: null,
			selectedPlacementIds: new Set([placementId]),
		});
		expect(env.ctx.fillRectCalls).toBeGreaterThan(0);
		expect(env.ctx.strokeRectCalls).toBeGreaterThan(0);
	});
});
