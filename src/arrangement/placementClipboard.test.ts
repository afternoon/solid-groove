import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Clip, Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory, type PlacementId } from "../domain/ids";
import { SONG_TEMPO } from "../domain/parameters";
import { minutesToTicks, TICKS_PER_BAR } from "../domain/time";
import {
	copyPlacements,
	createPlacementAt,
	cutPlacements,
	pastePlacements,
} from "./placementClipboard";
import { duplicatePlacement } from "./placementDuplication";
import { floorToBar } from "./placementGeometry";

function fixture(): {
	project: Project;
	placementId: PlacementId;
	clip: Clip;
} {
	const project = createSliceFixtureProject();
	return {
		project,
		placementId: project.song.placements[0].id,
		clip: project.clips[0],
	};
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

describe("clipboard: copy, cut, paste, delete (ARR-01)", () => {
	it("copies a placement's fields and pastes it at a snapped tick", () => {
		const { project, placementId } = fixture();
		const clipboard = copyPlacements(project, [placementId]);
		expect(clipboard).toHaveLength(1);

		const next = apply(
			project,
			pastePlacements(
				project,
				clipboard,
				TICKS_PER_BAR * 4 + 30,
				createSeededIdFactory("paste"),
			),
		);
		expect(next.song.placements).toHaveLength(2);
		const pasted = next.song.placements.find((p) => p.id !== placementId);
		expect(pasted?.startTicks).toBe(TICKS_PER_BAR * 4);
	});

	it("cut removes the placement and still yields clipboard content", () => {
		const { project, placementId } = fixture();
		const { clipboard, commands } = cutPlacements(project, [placementId]);
		expect(clipboard).toHaveLength(1);
		const next = apply(project, commands);
		expect(next.song.placements).toHaveLength(0);

		// The cut content pastes back, because paste re-resolves the clip from the
		// live project and the clip itself was never deleted.
		const restored = apply(
			next,
			pastePlacements(next, clipboard, 0, createSeededIdFactory("restore")),
		);
		expect(restored.song.placements).toHaveLength(1);
	});

	it("preserves relative offsets across a multi-placement paste", () => {
		const { project, placementId } = fixture();
		const ids = createSeededIdFactory("multi");
		const withSecond = apply(
			project,
			duplicatePlacement(project, placementId, "linked", ids).commands,
		);
		const allIds = withSecond.song.placements.map((p) => p.id);
		const clipboard = copyPlacements(withSecond, allIds);
		const gap =
			Math.max(...clipboard.map((e) => e.startTicks)) -
			Math.min(...clipboard.map((e) => e.startTicks));

		const next = apply(
			withSecond,
			pastePlacements(
				withSecond,
				clipboard,
				TICKS_PER_BAR * 8,
				createSeededIdFactory("multi-paste"),
			),
		);
		const pasted = next.song.placements
			.filter((p) => !allIds.includes(p.id))
			.map((p) => p.startTicks)
			.sort((a, b) => a - b);
		expect(pasted).toHaveLength(2);
		expect(pasted[0]).toBe(TICKS_PER_BAR * 8);
		expect(pasted[1] - pasted[0]).toBe(gap);
	});

	it("skips a clipboard entry whose clip no longer exists", () => {
		const { project, placementId } = fixture();
		const clipboard = copyPlacements(project, [placementId]);
		const stale = clipboard.map((entry) => ({
			...entry,
			clipId: "clp_gone" as typeof entry.clipId,
		}));
		expect(
			pastePlacements(project, stale, 0, createSeededIdFactory("stale")),
		).toEqual([]);
	});

	it("pasting an empty clipboard produces no commands", () => {
		const { project } = fixture();
		expect(
			pastePlacements(project, [], 0, createSeededIdFactory("empty")),
		).toEqual([]);
	});

	it("pastes at minute nine, inside ARR-01's ten-minute guarantee", () => {
		// pastePlacements silently skips an entry that would run past
		// MAX_ARRANGEMENT_TICKS, so a bound derived from the wrong end of the
		// tempo range turns paste into a no-op well inside the guarantee.
		const { project, placementId } = fixture();
		const clipboard = copyPlacements(project, [placementId]);
		const target = floorToBar(minutesToTicks(9, SONG_TEMPO.defaultValue));
		const commands = pastePlacements(
			project,
			clipboard,
			target,
			createSeededIdFactory("minute-nine"),
		);
		expect(commands).toHaveLength(1);
		const next = apply(project, commands);
		const pasted = next.song.placements.filter((p) => p.id !== placementId);
		expect(pasted).toHaveLength(1);
		expect(pasted[0].startTicks).toBe(target);
	});
});

describe("createPlacementAt", () => {
	it("places an existing clip on its own track at a snapped tick", () => {
		const { project, clip } = fixture();
		const { commands, placementId } = createPlacementAt(
			project,
			clip.id,
			TICKS_PER_BAR * 3 + 12,
			createSeededIdFactory("create"),
		);
		const next = apply(project, commands);
		const added = next.song.placements.find((p) => p.id === placementId);
		expect(added?.startTicks).toBe(TICKS_PER_BAR * 3);
		expect(added?.trackId).toBe(clip.trackId);
		expect(added?.looped).toBe(false);
	});

	it("declines a clip the project does not contain", () => {
		const { project } = fixture();
		const result = createPlacementAt(
			project,
			"clp_missing" as Clip["id"],
			0,
			createSeededIdFactory("missing"),
		);
		expect(result.commands).toEqual([]);
		expect(result.placementId).toBeNull();
	});
});

describe("createPlacementAt", () => {
	it("places an existing clip on its own track at a snapped tick", () => {
		const { project, clip } = fixture();
		const { commands, placementId } = createPlacementAt(
			project,
			clip.id,
			TICKS_PER_BAR * 3 + 12,
			createSeededIdFactory("create"),
		);
		const next = apply(project, commands);
		const added = next.song.placements.find((p) => p.id === placementId);
		expect(added?.startTicks).toBe(TICKS_PER_BAR * 3);
		expect(added?.trackId).toBe(clip.trackId);
		expect(added?.looped).toBe(false);
	});

	it("declines a clip the project does not contain", () => {
		const { project } = fixture();
		const result = createPlacementAt(
			project,
			"clp_missing" as Clip["id"],
			0,
			createSeededIdFactory("missing"),
		);
		expect(result.commands).toEqual([]);
		expect(result.placementId).toBeNull();
	});
});
