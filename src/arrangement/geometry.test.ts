import { describe, expect, it } from "vitest";
import {
	buildRowOffsets,
	pixelsToTicks,
	type RowMetrics,
	rowIndexAtOffset,
	ticksToPixels,
	type Viewport,
	visibleRowRange,
	visibleTickRange,
	zoomAtAnchor,
} from "./geometry";

const rowMetrics: RowMetrics = { trackHeightPx: 32, headerHeightPx: 32 };

function viewport(overrides: Partial<Viewport> = {}): Viewport {
	return {
		scrollLeft: 0,
		scrollTop: 0,
		width: 800,
		height: 480,
		pixelsPerTick: 0.1,
		...overrides,
	};
}

describe("tick/pixel conversion", () => {
	it("round trips ticks through pixels at a given zoom", () => {
		const port = viewport({ pixelsPerTick: 0.25 });
		expect(ticksToPixels(400, port)).toBe(100);
		expect(pixelsToTicks(100, port)).toBe(400);
	});
});

describe("visibleTickRange", () => {
	it("covers exactly the scrolled viewport width at pixelsPerTick 1", () => {
		const port = viewport({ scrollLeft: 500, width: 800, pixelsPerTick: 1 });
		expect(visibleTickRange(port)).toEqual({ startTick: 500, endTick: 1300 });
	});

	it("expands by the overscan on both sides", () => {
		const port = viewport({ scrollLeft: 500, width: 800, pixelsPerTick: 1 });
		expect(visibleTickRange(port, 50)).toEqual({
			startTick: 450,
			endTick: 1350,
		});
	});

	it("never returns a negative start tick even with a large overscan", () => {
		const port = viewport({ scrollLeft: 10, width: 800, pixelsPerTick: 1 });
		expect(visibleTickRange(port, 1000).startTick).toBe(0);
	});
});

describe("row offsets and lookup", () => {
	it("builds cumulative offsets for a uniform row height", () => {
		expect(buildRowOffsets(3, rowMetrics)).toEqual([0, 32, 64, 96]);
	});

	it("finds the row containing a given y", () => {
		const offsets = buildRowOffsets(5, rowMetrics);
		expect(rowIndexAtOffset(offsets, 0)).toBe(0);
		expect(rowIndexAtOffset(offsets, 31)).toBe(0);
		expect(rowIndexAtOffset(offsets, 32)).toBe(1);
		expect(rowIndexAtOffset(offsets, 159)).toBe(4);
	});

	it("returns -1 above the first row and rowCount at/after the last", () => {
		const offsets = buildRowOffsets(5, rowMetrics);
		expect(rowIndexAtOffset(offsets, -1)).toBe(-1);
		expect(rowIndexAtOffset(offsets, 160)).toBe(5);
	});

	it("reports -1/empty for zero rows", () => {
		expect(rowIndexAtOffset([0], 0)).toBe(-1);
	});
});

describe("visibleRowRange", () => {
	it("finds the visible rows for a scrolled viewport", () => {
		const offsets = buildRowOffsets(50, rowMetrics);
		const port = viewport({ scrollTop: 320, height: 480 });
		// rows 10..24 exactly fill 320..800
		expect(visibleRowRange(offsets, port)).toEqual({
			startRow: 10,
			endRow: 25,
		});
	});

	it("expands by overscan rows and clamps to valid indices", () => {
		const offsets = buildRowOffsets(50, rowMetrics);
		const port = viewport({ scrollTop: 0, height: 480 });
		const range = visibleRowRange(offsets, port, 3);
		expect(range.startRow).toBe(0);
		expect(range.endRow).toBe(15 + 3);
	});

	it("never exceeds the last valid row", () => {
		const offsets = buildRowOffsets(5, rowMetrics);
		const port = viewport({ scrollTop: 0, height: 4800 });
		expect(visibleRowRange(offsets, port, 10)).toEqual({
			startRow: 0,
			endRow: 4,
		});
	});
});

describe("zoomAtAnchor", () => {
	it("keeps the tick under the anchor fixed after zooming in", () => {
		const port = viewport({ scrollLeft: 100, pixelsPerTick: 1 });
		const anchorX = 50; // tick 150 before zoom
		const anchorTickBefore = pixelsToTicks(port.scrollLeft + anchorX, port);

		const result = zoomAtAnchor({
			viewport: port,
			nextPixelsPerTick: 2,
			anchorX,
		});
		const anchorTickAfter = pixelsToTicks(result.scrollLeft + anchorX, {
			pixelsPerTick: result.pixelsPerTick,
		});

		expect(anchorTickAfter).toBeCloseTo(anchorTickBefore, 6);
		expect(result.pixelsPerTick).toBe(2);
	});

	it("keeps the anchor tick fixed after zooming out too", () => {
		const port = viewport({ scrollLeft: 1000, pixelsPerTick: 2 });
		const anchorX = 200;
		const anchorTickBefore = pixelsToTicks(port.scrollLeft + anchorX, port);

		const result = zoomAtAnchor({
			viewport: port,
			nextPixelsPerTick: 0.5,
			anchorX,
		});
		const anchorTickAfter = pixelsToTicks(result.scrollLeft + anchorX, {
			pixelsPerTick: result.pixelsPerTick,
		});

		expect(anchorTickAfter).toBeCloseTo(anchorTickBefore, 6);
	});

	it("never scrolls to a negative offset", () => {
		const port = viewport({ scrollLeft: 0, pixelsPerTick: 1 });
		const result = zoomAtAnchor({
			viewport: port,
			nextPixelsPerTick: 0.1,
			anchorX: 500,
		});
		expect(result.scrollLeft).toBeGreaterThanOrEqual(0);
	});
});
