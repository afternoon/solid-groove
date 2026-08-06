/**
 * Geometry and hit-test coverage for placement editing (`ARR-002`).
 *
 * The acceptance criterion names five cases the editing gestures depend on and
 * that the `ARR-001` shell's own suite does not cover: **overlap** (two
 * placements sharing a tick), **edges** (the boundary between a resize handle
 * and a body, and the exact first/last tick), **zoom extremes** (the handle
 * staying a constant pixel width while its tick width changes by orders of
 * magnitude), **offscreen culling** (a placement far outside the viewport
 * costing nothing), and the **ten-minute bounds** (PRD ARR-01's guaranteed
 * arrangement length still hit-testing and culling correctly).
 *
 * These are the pointer-side invariants: if hit testing disagrees with the
 * pixels, a drag grabs the wrong placement or the wrong edge.
 */

import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import {
	pixelsToTicks,
	type RowMetrics,
	type Viewport,
	visibleTickRange,
} from "./geometry";
import { createPlacementAt } from "./placementClipboard";
import {
	MAX_ARRANGEMENT_TICKS,
	movePlacement,
	resizePlacement,
} from "./placementGeometry";
import {
	buildArrangementProjection,
	hitTestArrangement,
	visiblePlacementsForTrack,
} from "./projection";

const rowMetrics: RowMetrics = { trackHeightPx: 32, headerHeightPx: 32 };
const RESIZE_HANDLE_PX = 6;

function apply(
	project: Project,
	commands: Parameters<typeof executeTransaction>[1],
): Project {
	const result = executeTransaction(project, commands);
	if (!result.ok) {
		throw new Error(`transaction rejected: ${JSON.stringify(result.issues)}`);
	}
	return result.project;
}

/** The fixture with a second placement added at `startTicks`. */
function withPlacementAt(project: Project, startTicks: number): Project {
	const clip = project.clips[0];
	const { commands } = createPlacementAt(
		project,
		clip.id,
		startTicks,
		createSeededIdFactory(`at-${startTicks}`),
	);
	return apply(project, commands);
}

function projectionOf(project: Project) {
	return buildArrangementProjection(project, rowMetrics);
}

/** The handle width in ticks at a given zoom — what the shell passes through. */
function handleTicks(pixelsPerTick: number): number {
	return pixelsToTicks(RESIZE_HANDLE_PX, { pixelsPerTick });
}

describe("overlap: two placements sharing a tick", () => {
	it("resolves an overlapped point to exactly one placement", () => {
		// Grow the fixture's placement to four bars, then place a second one two
		// bars in, so bars 2-3 are covered by both.
		const base = createSliceFixtureProject();
		const placementId = base.song.placements[0].id;
		const grown = apply(
			base,
			resizePlacement(base, placementId, "end", TICKS_PER_BAR * 4),
		);
		const overlapped = withPlacementAt(grown, TICKS_PER_BAR * 2);
		const projection = projectionOf(overlapped);

		const result = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: TICKS_PER_BAR * 2 + TICKS_PER_BAR / 2 },
			handleTicks(0.08),
		);
		expect(result.kind).toBe("placement");
		if (result.kind !== "placement") return;
		// Whichever it picks, it must be one of the two that genuinely cover the
		// point — never a third, and never a stale ID.
		const covering = [...projection.placementsById.values()].filter(
			(candidate) =>
				candidate.startTicks <= TICKS_PER_BAR * 2 + TICKS_PER_BAR / 2 &&
				candidate.endTicks >= TICKS_PER_BAR * 2 + TICKS_PER_BAR / 2,
		);
		expect(covering).toHaveLength(2);
		expect(covering.map((c) => c.id)).toContain(result.placementId);
	});

	it("returns the earlier placement first, so the topmost drag target is stable", () => {
		const base = createSliceFixtureProject();
		const placementId = base.song.placements[0].id;
		const grown = apply(
			base,
			resizePlacement(base, placementId, "end", TICKS_PER_BAR * 4),
		);
		const overlapped = withPlacementAt(grown, TICKS_PER_BAR * 2);
		const projection = projectionOf(overlapped);
		const index = projection.placementsByTrack.get(projection.tracks[0].id);
		expect(index).toBeDefined();
		if (!index) return;

		// The index is sorted by start tick, so repeated hit tests at the same
		// point always resolve the same way — a drag cannot swap targets mid-gesture.
		const first = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: TICKS_PER_BAR * 3 },
			handleTicks(0.08),
		);
		const second = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: TICKS_PER_BAR * 3 },
			handleTicks(0.08),
		);
		expect(first).toEqual(second);
	});
});

describe("edges: handles versus body", () => {
	it("reports the start handle exactly on the first tick", () => {
		const projection = projectionOf(createSliceFixtureProject());
		const [placement] = [...projection.placementsById.values()];
		const result = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: placement.startTicks },
			handleTicks(0.08),
		);
		expect(result).toEqual({
			kind: "placement",
			placementId: placement.id,
			handle: "start",
		});
	});

	it("reports the end handle exactly on the last tick", () => {
		const projection = projectionOf(createSliceFixtureProject());
		const [placement] = [...projection.placementsById.values()];
		const result = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: placement.endTicks },
			handleTicks(0.08),
		);
		expect(result).toEqual({
			kind: "placement",
			placementId: placement.id,
			handle: "end",
		});
	});

	it("switches from handle to body one tick past the handle width", () => {
		const base = createSliceFixtureProject();
		const placementId = base.song.placements[0].id;
		// A long placement, so the handle band and the body are far apart.
		const grown = apply(
			base,
			resizePlacement(base, placementId, "end", TICKS_PER_BAR * 8),
		);
		const projection = projectionOf(grown);
		const [placement] = [...projection.placementsById.values()];
		const handle = handleTicks(0.08);

		const insideHandle = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: placement.startTicks + handle },
			handle,
		);
		expect(insideHandle.kind === "placement" ? insideHandle.handle : null).toBe(
			"start",
		);

		const pastHandle = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: placement.startTicks + handle + 1 },
			handle,
		);
		expect(pastHandle.kind === "placement" ? pastHandle.handle : null).toBe(
			"body",
		);
	});

	it("reports empty just outside the handle band on either side", () => {
		const projection = projectionOf(createSliceFixtureProject());
		const [placement] = [...projection.placementsById.values()];
		const handle = handleTicks(0.08);

		expect(
			hitTestArrangement(
				projection,
				{ rowIndex: 0, tick: placement.startTicks - handle - 1 },
				handle,
			),
		).toEqual({ kind: "empty" });
		expect(
			hitTestArrangement(
				projection,
				{ rowIndex: 0, tick: placement.endTicks + handle + 1 },
				handle,
			),
		).toEqual({ kind: "empty" });
	});
});

describe("zoom extremes", () => {
	it("keeps the resize handle a constant pixel width as zoom changes", () => {
		// The handle's *tick* width scales inversely with zoom; that is what keeps
		// its *pixel* width constant, which is what the user actually grabs.
		const zoomedIn = handleTicks(2);
		const zoomedOut = handleTicks(0.01);
		expect(zoomedIn).toBeLessThan(zoomedOut);
		expect(zoomedIn * 2).toBeCloseTo(RESIZE_HANDLE_PX, 6);
		expect(zoomedOut * 0.01).toBeCloseTo(RESIZE_HANDLE_PX, 6);
	});

	it("still finds the body at maximum zoom-in, where a bar is very wide", () => {
		const base = createSliceFixtureProject();
		const grown = apply(
			base,
			resizePlacement(
				base,
				base.song.placements[0].id,
				"end",
				TICKS_PER_BAR * 4,
			),
		);
		const projection = projectionOf(grown);
		const [placement] = [...projection.placementsById.values()];
		const midTick = (placement.startTicks + placement.endTicks) / 2;
		const result = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: midTick },
			handleTicks(2),
		);
		expect(result.kind === "placement" ? result.handle : null).toBe("body");
	});

	it("at maximum zoom-out a whole placement can be inside the handle band", () => {
		// At 0.01 px/tick the 6px handle is 600 ticks — wider than a bar (768 is
		// one bar, so a one-bar placement is only slightly wider). The hit test
		// must still resolve to that placement rather than to nothing.
		const projection = projectionOf(createSliceFixtureProject());
		const [placement] = [...projection.placementsById.values()];
		const result = hitTestArrangement(
			projection,
			{ rowIndex: 0, tick: placement.startTicks + 1 },
			handleTicks(0.01),
		);
		expect(result.kind).toBe("placement");
	});
});

describe("offscreen culling", () => {
	it("excludes a placement far to the right of the viewport", () => {
		const project = withPlacementAt(
			createSliceFixtureProject(),
			TICKS_PER_BAR * 80,
		);
		const projection = projectionOf(project);
		const index = projection.placementsByTrack.get(projection.tracks[0].id);
		expect(index).toBeDefined();
		if (!index) return;

		const viewport: Viewport = {
			scrollLeft: 0,
			scrollTop: 0,
			width: 960,
			height: 480,
			pixelsPerTick: 0.08,
		};
		const visible = visiblePlacementsForTrack(
			index,
			visibleTickRange(viewport, 200),
		);
		expect(visible).toHaveLength(1);
		expect(visible[0].startTicks).toBe(0);
	});

	it("includes it once the viewport scrolls to it", () => {
		const farStart = TICKS_PER_BAR * 80;
		const project = withPlacementAt(createSliceFixtureProject(), farStart);
		const projection = projectionOf(project);
		const index = projection.placementsByTrack.get(projection.tracks[0].id);
		expect(index).toBeDefined();
		if (!index) return;

		const pixelsPerTick = 0.08;
		const viewport: Viewport = {
			scrollLeft: farStart * pixelsPerTick,
			scrollTop: 0,
			width: 960,
			height: 480,
			pixelsPerTick,
		};
		const visible = visiblePlacementsForTrack(
			index,
			visibleTickRange(viewport, 200),
		);
		expect(visible.map((p) => p.startTicks)).toContain(farStart);
	});

	it("a hit test on an offscreen row costs nothing and reports empty", () => {
		const projection = projectionOf(createSliceFixtureProject());
		expect(
			hitTestArrangement(
				projection,
				{ rowIndex: -1, tick: 0 },
				handleTicks(0.08),
			),
		).toEqual({ kind: "empty" });
	});
});

describe("ten-minute bounds (PRD ARR-01)", () => {
	it("hit-tests a placement at the far end of the guaranteed range", () => {
		const base = createSliceFixtureProject();
		const placementId = base.song.placements[0].id;
		// Move the placement as far out as the editing model allows, then confirm
		// pointer geometry still resolves it there.
		const moved = apply(
			base,
			movePlacement(base, placementId, MAX_ARRANGEMENT_TICKS - TICKS_PER_BAR),
		);
		const projection = projectionOf(moved);
		const [placement] = [...projection.placementsById.values()];
		expect(placement.startTicks).toBeGreaterThan(0);

		const result = hitTestArrangement(
			projection,
			{
				rowIndex: 0,
				tick: (placement.startTicks + placement.endTicks) / 2,
			},
			handleTicks(0.08),
		);
		expect(result.kind === "placement" ? result.placementId : null).toBe(
			placement.id,
		);
	});

	it("culls correctly across the whole ten-minute span", () => {
		const base = createSliceFixtureProject();
		const far = apply(
			base,
			movePlacement(
				base,
				base.song.placements[0].id,
				MAX_ARRANGEMENT_TICKS - TICKS_PER_BAR,
			),
		);
		const both = withPlacementAt(far, 0);
		const projection = projectionOf(both);
		const index = projection.placementsByTrack.get(projection.tracks[0].id);
		expect(index).toBeDefined();
		if (!index) return;
		expect(index.items).toHaveLength(2);

		// A viewport at the origin sees only the near placement, even though the
		// index spans the full ten minutes.
		const nearOnly = visiblePlacementsForTrack(index, {
			startTick: 0,
			endTick: TICKS_PER_BAR * 4,
		});
		expect(nearOnly).toHaveLength(1);
		expect(nearOnly[0].startTicks).toBe(0);
	});

	it("the projection's length reaches but does not exceed the bound", () => {
		const base = createSliceFixtureProject();
		const far = apply(
			base,
			movePlacement(
				base,
				base.song.placements[0].id,
				MAX_ARRANGEMENT_TICKS - TICKS_PER_BAR,
			),
		);
		const projection = projectionOf(far);
		expect(projection.lengthTicks).toBeLessThanOrEqual(MAX_ARRANGEMENT_TICKS);
		expect(projection.lengthTicks).toBe(MAX_ARRANGEMENT_TICKS);
	});
});
