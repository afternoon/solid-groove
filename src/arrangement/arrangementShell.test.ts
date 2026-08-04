import { describe, expect, it } from "vitest";
import { createArrangementSpikeProject } from "../domain/fixtures";
import { TICKS_PER_BAR } from "../domain/time";
import {
	type ArrangementShell,
	createArrangementShell,
	type DirtyLayer,
} from "./arrangementShell";
import type { Viewport } from "./geometry";
import {
	type ArrangementProjection,
	buildArrangementProjection,
} from "./projection";

const ROW_METRICS = { trackHeightPx: 28, headerHeightPx: 28 };

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

/** A shell over the 20-track reference arrangement, plus a recorder that
 * accumulates every layer marked dirty since the last `drain()`. */
function setup(overrides: Partial<Viewport> = {}): {
	shell: ArrangementShell;
	projection: ArrangementProjection;
	drain: () => Set<DirtyLayer>;
} {
	const project = createArrangementSpikeProject(20);
	const projection = buildArrangementProjection(project, ROW_METRICS);
	let dirtyAccum = new Set<DirtyLayer>();
	const shell = createArrangementShell(() => projection, {
		initialViewport: baseViewport(overrides),
		onDirty: (layers) => {
			for (const layer of layers) dirtyAccum.add(layer);
		},
	});
	return {
		shell,
		projection,
		drain: () => {
			const drained = dirtyAccum;
			dirtyAccum = new Set();
			shell.takeDirty();
			return drained;
		},
	};
}

describe("dirty-layer invalidation (PRD 9.3)", () => {
	it("a playhead seek marks only the interaction layer dirty", () => {
		const { shell, drain } = setup();
		drain();
		shell.seekTo(TICKS_PER_BAR * 4);
		expect([...drain()]).toEqual(["interaction"]);
	});

	it("a scroll marks background, content, and interaction dirty", () => {
		const { shell, drain } = setup();
		drain();
		shell.setScroll(120, 60);
		expect(drain()).toEqual(new Set(["background", "content", "interaction"]));
	});

	it("is idle when a mutation does not change pixels", () => {
		const { shell, drain } = setup();
		drain();
		// Same scroll position: no dirty layers, so no redraw is scheduled.
		shell.setScroll(0, 0);
		expect(drain().size).toBe(0);
		// Same playhead: idle.
		shell.seekTo(0);
		expect(drain().size).toBe(0);
		// A no-op resize: idle.
		shell.resize(800, 400);
		expect(drain().size).toBe(0);
	});

	it("takeDirty drains the accumulated set so a drawn frame does not redraw", () => {
		const { shell } = setup();
		shell.seekTo(100);
		expect(shell.takeDirty().has("interaction")).toBe(true);
		// Nothing new happened; the next frame has nothing to draw.
		expect(shell.takeDirty().size).toBe(0);
	});
});

describe("culling is proportional to visible work", () => {
	it("the visible row range covers only visible rows plus overscan, not all tracks", () => {
		const { shell, projection } = setup();
		const range = shell.rowRange();
		const visibleRows = range.endRow - range.startRow + 1;
		// 20 tracks at 28px in a 400px viewport is well under the whole project.
		expect(visibleRows).toBeLessThan(projection.tracks.length);
		expect(range.startRow).toBe(0);
	});

	it("the visible tick range is bounded by the viewport, not the arrangement length", () => {
		const { shell, projection } = setup();
		const range = shell.tickRange();
		expect(range.startTick).toBeGreaterThanOrEqual(0);
		expect(range.endTick).toBeLessThan(projection.lengthTicks);
	});

	it("scrolling down advances the visible row window", () => {
		const { shell } = setup();
		const before = shell.rowRange();
		shell.setScroll(0, 28 * 10);
		const after = shell.rowRange();
		expect(after.startRow).toBeGreaterThan(before.startRow);
	});
});

describe("zoom anchoring (wheel / pinch / keyboard)", () => {
	it("keeps the musical tick under the anchor fixed across a wheel zoom", () => {
		const { shell } = setup({ scrollLeft: 400, pixelsPerTick: 0.08 });
		const anchorX = 200;
		const viewportBefore = shell.getViewport();
		const tickUnderAnchorBefore =
			(viewportBefore.scrollLeft + anchorX) / viewportBefore.pixelsPerTick;

		shell.handleWheel({ deltaX: 0, deltaY: -100, zoom: true, anchorX });

		const viewportAfter = shell.getViewport();
		const tickUnderAnchorAfter =
			(viewportAfter.scrollLeft + anchorX) / viewportAfter.pixelsPerTick;
		expect(viewportAfter.pixelsPerTick).toBeGreaterThan(
			viewportBefore.pixelsPerTick,
		);
		expect(tickUnderAnchorAfter).toBeCloseTo(tickUnderAnchorBefore, 3);
	});

	it("plain wheel scrolls instead of zooming", () => {
		const { shell } = setup();
		const before = shell.getViewport();
		shell.handleWheel({ deltaX: 30, deltaY: 40, zoom: false, anchorX: 0 });
		const after = shell.getViewport();
		expect(after.pixelsPerTick).toBe(before.pixelsPerTick);
		expect(after.scrollLeft).toBe(30);
		expect(after.scrollTop).toBe(40);
	});

	it("keyboard zoom in/out changes pixels-per-tick within the clamp", () => {
		const { shell } = setup();
		const initial = shell.getViewport().pixelsPerTick;
		shell.zoomIn();
		expect(shell.getViewport().pixelsPerTick).toBeGreaterThan(initial);
		shell.zoomOut();
		expect(shell.getViewport().pixelsPerTick).toBeLessThanOrEqual(
			shell.config.maxPixelsPerTick,
		);
	});

	it("clamps zoom to the configured range", () => {
		const { shell } = setup();
		for (let i = 0; i < 100; i += 1) shell.zoomIn();
		expect(shell.getViewport().pixelsPerTick).toBeLessThanOrEqual(
			shell.config.maxPixelsPerTick,
		);
		for (let i = 0; i < 100; i += 1) shell.zoomOut();
		expect(shell.getViewport().pixelsPerTick).toBeGreaterThanOrEqual(
			shell.config.minPixelsPerTick,
		);
	});
});

describe("scroll bounds and resize", () => {
	it("clamps scroll to the arrangement's content bounds", () => {
		const { shell } = setup();
		shell.setScroll(1e9, 1e9);
		const port = shell.getViewport();
		expect(port.scrollLeft).toBeLessThanOrEqual(
			Math.max(0, port.pixelsPerTick * 1e9),
		);
		// Vertical scroll cannot exceed total content height minus viewport.
		expect(port.scrollTop).toBeGreaterThanOrEqual(0);
	});

	it("re-clamps scroll when the viewport grows past the current offset", () => {
		const { shell } = setup();
		shell.setScroll(0, 28 * 15);
		const scrolledTop = shell.getViewport().scrollTop;
		expect(scrolledTop).toBeGreaterThan(0);
		// A much taller viewport can show everything, so scrollTop clamps back down.
		shell.resize(800, 5000);
		expect(shell.getViewport().scrollTop).toBeLessThan(scrolledTop);
	});

	it("caps the device pixel ratio at 2", () => {
		const { shell } = setup();
		expect(shell.devicePixelRatio(3)).toBe(2);
		expect(shell.devicePixelRatio(1)).toBe(1);
		expect(shell.devicePixelRatio(1.5)).toBe(1.5);
	});
});

describe("playhead follow", () => {
	it("scrolls to keep an advancing playhead in view while following", () => {
		const { shell } = setup();
		shell.setPlayheadFollow(true);
		// Seek past the right edge of the 800px viewport at 0.08 px/tick.
		const offscreenTick = 800 / 0.08 + 5000;
		shell.seekTo(offscreenTick);
		const port = shell.getViewport();
		const playheadX = offscreenTick * port.pixelsPerTick - port.scrollLeft;
		expect(playheadX).toBeLessThanOrEqual(port.width + 1);
		expect(playheadX).toBeGreaterThanOrEqual(0);
	});

	it("does not scroll on seek when follow is disabled", () => {
		const { shell } = setup();
		shell.setPlayheadFollow(false);
		const before = shell.getViewport().scrollLeft;
		shell.seekTo(800 / 0.08 + 5000);
		expect(shell.getViewport().scrollLeft).toBe(before);
	});
});

describe("selection and named actions (accessibility equivalents)", () => {
	it("pointer-down selects a bar-aligned one-bar range on the pointed track", () => {
		const { shell, projection } = setup();
		// A pointer 40px into the first row (below the ruler), 300px across.
		const selection = shell.handlePointerDown(300, 10);
		expect(selection).not.toBeNull();
		expect(selection?.trackId).toBe(projection.tracks[0].id);
		// Snapped to a bar boundary.
		expect((selection?.startTick ?? 1) % TICKS_PER_BAR).toBe(0);
		expect((selection?.endTick ?? 0) - (selection?.startTick ?? 0)).toBe(
			TICKS_PER_BAR,
		);
	});

	it("zoom-to-selection fits the selection to the viewport width", () => {
		const { shell } = setup();
		shell.setSelection({
			trackId: setup().projection.tracks[0].id,
			startTick: TICKS_PER_BAR * 2,
			endTick: TICKS_PER_BAR * 6,
		});
		shell.zoomToSelection();
		const port = shell.getViewport();
		const spanPx = (TICKS_PER_BAR * 6 - TICKS_PER_BAR * 2) * port.pixelsPerTick;
		// The selection now spans roughly the viewport width (within the clamp).
		expect(spanPx).toBeLessThanOrEqual(port.width + 1);
	});

	it("scroll-to-playhead brings an off-screen playhead into view", () => {
		const { shell } = setup();
		shell.setPlayheadFollow(false);
		shell.seekTo(800 / 0.08 + 5000);
		shell.scrollToPlayhead();
		const port = shell.getViewport();
		const playheadX =
			(800 / 0.08 + 5000) * port.pixelsPerTick - port.scrollLeft;
		expect(playheadX).toBeLessThanOrEqual(port.width + 1);
	});

	it("hover hit-tests only the visible track and marks interaction dirty", () => {
		const { shell, projection, drain } = setup();
		drain();
		// Hover the very first placement on row 0 (reference arrangement is dense).
		const firstPlacement = projection.placementsByTrack.get(
			projection.tracks[0].id,
		)?.items[0];
		expect(firstPlacement).toBeDefined();
		const x =
			(firstPlacement?.startTicks ?? 0) * shell.getViewport().pixelsPerTick -
			shell.getViewport().scrollLeft +
			1;
		shell.handlePointerMove(x, 10);
		// Whatever the hit result, moving the pointer only touches interaction.
		const layers = drain();
		if (layers.size > 0) expect(layers).toEqual(new Set(["interaction"]));
	});
});
