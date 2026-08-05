import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { PlacementId } from "../domain/ids";
import { SONG_TEMPO } from "../domain/parameters";
import { minutesToTicks, TICKS_PER_BAR, ticksToSeconds } from "../domain/time";
import {
	clampTick,
	deletePlacements,
	floorToBar,
	MAX_ARRANGEMENT_TICKS,
	movePlacement,
	resizePlacement,
	setPlacementLooped,
	snapToBar,
} from "./placementGeometry";

function fixture(): { project: Project; placementId: PlacementId } {
	const project = createSliceFixtureProject();
	return { project, placementId: project.song.placements[0].id };
}

/** Applies the operation's commands the way the editor does: one transaction. */
function apply(
	project: Project,
	commands: Parameters<typeof executeTransaction>[1],
) {
	const result = executeTransaction(project, commands);
	expect(
		result.ok,
		JSON.stringify((result as { issues?: unknown }).issues),
	).toBe(true);
	return result.project;
}

describe("bar snapping (ARR-01: placements snap to bars by default)", () => {
	it("snaps to the nearest bar in both directions", () => {
		expect(snapToBar(TICKS_PER_BAR * 0.4)).toBe(0);
		expect(snapToBar(TICKS_PER_BAR * 0.6)).toBe(TICKS_PER_BAR);
		expect(snapToBar(TICKS_PER_BAR * 2)).toBe(TICKS_PER_BAR * 2);
	});

	it("floors to the bar at or before the tick", () => {
		expect(floorToBar(TICKS_PER_BAR * 1.9)).toBe(TICKS_PER_BAR);
		expect(floorToBar(TICKS_PER_BAR)).toBe(TICKS_PER_BAR);
	});

	it("never snaps below zero or past the ten-minute guarantee", () => {
		expect(snapToBar(-TICKS_PER_BAR * 5)).toBe(0);
		expect(snapToBar(MAX_ARRANGEMENT_TICKS * 10)).toBeLessThanOrEqual(
			MAX_ARRANGEMENT_TICKS,
		);
	});

	// ARR-01 guarantees 10:00 "at any supported tempo". Asserting the bound in
	// *seconds* is what ties it to the product promise; comparing the constant
	// to itself would pass for any value, including one that caps the
	// arrangement at 3:20.
	it("guarantees ten minutes at the fastest tempo a project may store", () => {
		expect(
			ticksToSeconds(MAX_ARRANGEMENT_TICKS, SONG_TEMPO.max),
		).toBeGreaterThanOrEqual(600);
	});

	it("does not clamp an edit inside the guaranteed span at the default tempo", () => {
		const minuteNine = floorToBar(minutesToTicks(9, SONG_TEMPO.defaultValue));
		expect(snapToBar(minuteNine)).toBe(minuteNine);
		expect(clampTick(minuteNine)).toBe(minuteNine);
	});

	it("treats a non-finite drag position as tick zero rather than NaN", () => {
		expect(snapToBar(Number.NaN)).toBe(0);
		expect(snapToBar(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("movePlacement", () => {
	it("moves to a bar-snapped start and leaves the project valid", () => {
		const { project, placementId } = fixture();
		const commands = movePlacement(
			project,
			placementId,
			TICKS_PER_BAR * 2 + 17,
		);
		const next = apply(project, commands);
		expect(next.song.placements[0].startTicks).toBe(TICKS_PER_BAR * 2);
	});

	it("is a no-op when the snapped position is already current", () => {
		const { project, placementId } = fixture();
		expect(movePlacement(project, placementId, 5)).toEqual([]);
	});

	it("declines a move onto a track that does not own the clip", () => {
		const { project, placementId } = fixture();
		const foreignTrackId = project.song.tracks[0].id;
		// The fixture has one track, so fabricate a different ID to stand for a
		// track the clip does not belong to.
		const otherTrackId = `${foreignTrackId}x` as typeof foreignTrackId;
		expect(
			movePlacement(project, placementId, TICKS_PER_BAR, otherTrackId),
		).toEqual([]);
	});

	it("ignores an unknown placement rather than throwing", () => {
		const { project } = fixture();
		expect(movePlacement(project, "plc_missing" as PlacementId, 0)).toEqual([]);
	});

	it("lands a drag to minute nine exactly, not silently clamped short", () => {
		const { project, placementId } = fixture();
		const target = floorToBar(minutesToTicks(9, SONG_TEMPO.defaultValue));
		const next = apply(project, movePlacement(project, placementId, target));
		expect(next.song.placements[0].startTicks).toBe(target);
		expect(ticksToSeconds(next.song.placements[0].startTicks, 120)).toBeCloseTo(
			540,
			0,
		);
	});
});

describe("resizePlacement", () => {
	it("stretches a placement out to minute nine without clamping short", () => {
		// clampDuration caps at MAX_ARRANGEMENT_TICKS, so a bound taken from the
		// slow end of the tempo range would truncate this resize.
		const { project, placementId } = fixture();
		const target = floorToBar(minutesToTicks(9, SONG_TEMPO.defaultValue));
		const next = apply(
			project,
			resizePlacement(project, placementId, "end", target),
		);
		const placement = next.song.placements[0];
		// Assert in seconds, not against `target`: snapToBar clamps its own input,
		// so a tick-only assertion stays self-consistent under a wrong bound.
		expect(
			ticksToSeconds(placement.startTicks + placement.durationTicks, 120),
		).toBeCloseTo(540, 0);
	});

	it("resizes from the end edge by whole bars", () => {
		const { project, placementId } = fixture();
		const next = apply(
			project,
			resizePlacement(project, placementId, "end", TICKS_PER_BAR * 3 + 40),
		);
		expect(next.song.placements[0].durationTicks).toBe(TICKS_PER_BAR * 3);
	});

	it("keeps the far edge fixed when dragging the start edge", () => {
		const { project, placementId } = fixture();
		const grown = apply(
			project,
			resizePlacement(project, placementId, "end", TICKS_PER_BAR * 4),
		);
		const before = grown.song.placements[0];
		const endTicks = before.startTicks + before.durationTicks;

		const next = apply(
			grown,
			resizePlacement(grown, placementId, "start", TICKS_PER_BAR),
		);
		const after = next.song.placements[0];
		expect(after.startTicks).toBe(TICKS_PER_BAR);
		expect(after.startTicks + after.durationTicks).toBe(endTicks);
	});

	it("advances the clip offset in step with a trimmed head", () => {
		const { project, placementId } = fixture();
		const grown = apply(
			project,
			resizePlacement(project, placementId, "end", TICKS_PER_BAR * 4),
		);
		const next = apply(
			grown,
			resizePlacement(grown, placementId, "start", TICKS_PER_BAR * 2),
		);
		expect(next.song.placements[0].clipOffsetTicks).toBe(TICKS_PER_BAR * 2);
	});

	it("never shrinks a placement below one bar from either edge", () => {
		const { project, placementId } = fixture();
		// The fixture is already one bar, so dragging its end edge back past the
		// start clamps to that same one bar — i.e. changes nothing at all.
		expect(
			resizePlacement(project, placementId, "end", -TICKS_PER_BAR * 4),
		).toEqual([]);

		// From a longer placement the clamp is observable as a real edit.
		const long = apply(
			project,
			resizePlacement(project, placementId, "end", TICKS_PER_BAR * 5),
		);
		const fromEnd = apply(
			long,
			resizePlacement(long, placementId, "end", -TICKS_PER_BAR * 4),
		);
		expect(fromEnd.song.placements[0].durationTicks).toBe(TICKS_PER_BAR);

		const grown = apply(
			project,
			resizePlacement(project, placementId, "end", TICKS_PER_BAR * 2),
		);
		const squeezed = apply(
			grown,
			resizePlacement(grown, placementId, "start", TICKS_PER_BAR * 9),
		);
		expect(squeezed.song.placements[0].durationTicks).toBe(TICKS_PER_BAR);
	});
});

describe("setPlacementLooped", () => {
	it("toggles the loop flag and is a no-op when already set", () => {
		const { project, placementId } = fixture();
		const next = apply(project, setPlacementLooped(project, placementId, true));
		expect(next.song.placements[0].looped).toBe(true);
		expect(setPlacementLooped(next, placementId, true)).toEqual([]);
	});
});

describe("deletePlacements", () => {
	it("deletes selected placements and ignores unknown IDs", () => {
		const { project, placementId } = fixture();
		expect(deletePlacements(project, ["plc_missing" as PlacementId])).toEqual(
			[],
		);
		const next = apply(project, deletePlacements(project, [placementId]));
		expect(next.song.placements).toHaveLength(0);
		// Deleting a placement never deletes the clip it referenced — that is what
		// makes the clip reusable.
		expect(next.clips).toHaveLength(project.clips.length);
	});

	it("addresses placements by ID, not array position", () => {
		const { project, placementId } = fixture();
		// Reverse the array; the placement's ID must still resolve to the same one.
		const reordered: Project = {
			...project,
			song: {
				...project.song,
				placements: [...project.song.placements].reverse(),
			},
		};
		const next = apply(
			reordered,
			movePlacement(reordered, placementId, TICKS_PER_BAR * 6),
		);
		expect(
			next.song.placements.find((p) => p.id === placementId)?.startTicks,
		).toBe(TICKS_PER_BAR * 6);
	});
});
