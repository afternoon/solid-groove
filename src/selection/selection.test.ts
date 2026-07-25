import { describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import {
	createFactoryContext,
	createNoteClip,
	createNoteEvent,
	createPlacement,
	createProjectMetadata,
	createSection,
	createTrack,
} from "../domain/factories";
import {
	createDrumMachineFixtureProject,
	createReferenceProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import type { AutomationId, DeviceId } from "../domain/ids";
import { createSeededIdFactory } from "../domain/ids";
import { assertProject } from "../domain/parse";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import {
	addToSelection,
	buildSelectionEntityIndex,
	clearSelection,
	emptySelection,
	isEmptySelection,
	reconcileSelection,
	removeFromSelection,
	scopeKey,
	scopesEqual,
	selectOnly,
	setFocus,
	toggleInSelection,
} from "./selection";
import type { SelectionScope } from "./types";

function requireDefined<T>(value: T | undefined, message: string): T {
	if (value === undefined) {
		throw new Error(message);
	}
	return value;
}

/**
 * A project with one device (on its one track) and one automation lane (with
 * two points), so device and automationPoint scopes have something concrete
 * to reference. Neither the slice nor drum-machine fixtures create devices,
 * since the FND-009 slice needs none.
 */
function buildProjectWithDeviceAndAutomation(seed: string): {
	project: Project;
	trackId: Project["song"]["tracks"][number]["id"];
	deviceId: DeviceId;
	laneId: AutomationId;
} {
	const context = createFactoryContext({ ids: createSeededIdFactory(seed) });
	const deviceId = context.ids("device");
	const track = createTrack(context, {
		name: "Lead",
		order: 0,
		devices: [
			{
				id: deviceId,
				type: "filter",
				order: 0,
				bypassed: false,
				parameters: {},
				preset: null,
			},
		],
	});
	const clip = createNoteClip(context, {
		trackId: track.id,
		name: "Clip",
		events: [
			createNoteEvent(context, { startTicks: 0, durationTicks: 48, pitch: 60 }),
		],
	});
	const placement = createPlacement(context, {
		clipId: clip.id,
		trackId: track.id,
		startTicks: 0,
		durationTicks: TICKS_PER_BAR,
	});
	const laneId = context.ids("automation");
	const section = createSection(context, {
		name: "Verse",
		startTicks: 0,
		durationTicks: TICKS_PER_BAR,
	});

	const project = assertProject({
		metadata: createProjectMetadata(context, {
			ownerId: "user_fixture",
			name: "Device fixture",
		}),
		song: {
			tempo: 120,
			timeSignature: { numerator: 4, denominator: 4 },
			tracks: [track],
			returns: [],
			master: { volume: 0, devices: [] },
			sections: [section],
			placements: [placement],
			automation: [
				{
					id: laneId,
					target: {
						scope: "track",
						trackId: track.id,
						parameterId: "track.volume",
					},
					interpolation: "linear",
					points: [
						{ tick: toTicks(0), value: 0 },
						{ tick: toTicks(96), value: 3 },
					],
				},
			],
			assets: [],
		},
		clips: [clip],
	});

	return { project, trackId: track.id, deviceId, laneId };
}

describe("emptySelection / isEmptySelection", () => {
	it("is a stable, reusable empty reference", () => {
		expect(emptySelection()).toBe(emptySelection());
		expect(isEmptySelection(emptySelection())).toBe(true);
	});

	it("clearSelection returns the same reference as emptySelection", () => {
		expect(clearSelection()).toBe(emptySelection());
	});
});

describe("scopeKey / scopesEqual", () => {
	it("gives entity-kind scopes a key derived only from kind and id", () => {
		const a: SelectionScope = { kind: "track", id: "trk_a" as never };
		const b: SelectionScope = { kind: "track", id: "trk_a" as never };
		const c: SelectionScope = { kind: "clip", id: "trk_a" as never };
		expect(scopesEqual(a, b)).toBe(true);
		expect(scopesEqual(a, c)).toBe(false);
	});

	it("keys an automation point by lane and tick", () => {
		const a: SelectionScope = {
			kind: "automationPoint",
			laneId: "aut_a" as never,
			tick: toTicks(96),
		};
		const b: SelectionScope = {
			kind: "automationPoint",
			laneId: "aut_a" as never,
			tick: toTicks(96),
		};
		const c: SelectionScope = {
			kind: "automationPoint",
			laneId: "aut_a" as never,
			tick: toTicks(192),
		};
		expect(scopesEqual(a, b)).toBe(true);
		expect(scopesEqual(a, c)).toBe(false);
	});

	it("keys a bar range independent of track ID order", () => {
		const a: SelectionScope = {
			kind: "barRange",
			startTicks: toTicks(0),
			endTicks: toTicks(TICKS_PER_BAR),
			trackIds: ["trk_a", "trk_b"] as never,
		};
		const b: SelectionScope = {
			kind: "barRange",
			startTicks: toTicks(0),
			endTicks: toTicks(TICKS_PER_BAR),
			trackIds: ["trk_b", "trk_a"] as never,
		};
		expect(scopeKey(a)).toBe(scopeKey(b));
	});
});

describe("selection mutators", () => {
	const trackScope = (id: string): SelectionScope => ({
		kind: "track",
		id: id as never,
	});

	it("selectOnly replaces the whole selection and focuses the new scope", () => {
		const state = selectOnly(trackScope("trk_a"));
		expect(state.scopes).toEqual([trackScope("trk_a")]);
		expect(state.focus).toEqual(trackScope("trk_a"));
	});

	it("addToSelection appends and focuses without duplicating", () => {
		let state = selectOnly(trackScope("trk_a"));
		state = addToSelection(state, trackScope("trk_b"));
		expect(state.scopes).toEqual([trackScope("trk_a"), trackScope("trk_b")]);
		expect(state.focus).toEqual(trackScope("trk_b"));

		const before = state;
		state = addToSelection(state, trackScope("trk_b"));
		expect(state).toBe(before);
	});

	it("addToSelection re-focuses an already-selected scope without duplicating it", () => {
		let state = selectOnly(trackScope("trk_a"));
		state = addToSelection(state, trackScope("trk_b"));
		state = addToSelection(state, trackScope("trk_a"));
		expect(state.scopes).toEqual([trackScope("trk_a"), trackScope("trk_b")]);
		expect(state.focus).toEqual(trackScope("trk_a"));
	});

	it("removeFromSelection drops a scope and re-focuses the last remaining one", () => {
		let state = selectOnly(trackScope("trk_a"));
		state = addToSelection(state, trackScope("trk_b"));
		state = removeFromSelection(state, trackScope("trk_b"));
		expect(state.scopes).toEqual([trackScope("trk_a")]);
		expect(state.focus).toEqual(trackScope("trk_a"));
	});

	it("removeFromSelection clears focus once the last scope is gone", () => {
		let state = selectOnly(trackScope("trk_a"));
		state = removeFromSelection(state, trackScope("trk_a"));
		expect(state).toEqual(emptySelection());
	});

	it("removeFromSelection is a no-op for a scope that is not selected", () => {
		const state = selectOnly(trackScope("trk_a"));
		expect(removeFromSelection(state, trackScope("trk_z"))).toBe(state);
	});

	it("toggleInSelection adds when absent and removes when present", () => {
		let state = emptySelection();
		state = toggleInSelection(state, trackScope("trk_a"));
		expect(state.scopes).toEqual([trackScope("trk_a")]);
		state = toggleInSelection(state, trackScope("trk_a"));
		expect(state).toEqual(emptySelection());
	});

	it("setFocus moves focus among already-selected scopes without changing the set", () => {
		let state = selectOnly(trackScope("trk_a"));
		state = addToSelection(state, trackScope("trk_b"));
		const scopesBefore = state.scopes;
		state = setFocus(state, trackScope("trk_a"));
		expect(state.scopes).toBe(scopesBefore);
		expect(state.focus).toEqual(trackScope("trk_a"));
	});

	it("setFocus adds a not-yet-selected scope", () => {
		const state = setFocus(emptySelection(), trackScope("trk_a"));
		expect(state.scopes).toEqual([trackScope("trk_a")]);
		expect(state.focus).toEqual(trackScope("trk_a"));
	});

	it("setFocus is a no-op if the scope is already focused", () => {
		const state = selectOnly(trackScope("trk_a"));
		expect(setFocus(state, trackScope("trk_a"))).toBe(state);
	});
});

describe("reconcileSelection: empty state", () => {
	it("returns the same reference for an empty selection", () => {
		const project = createSliceFixtureProject();
		const state = emptySelection();
		expect(reconcileSelection(state, project)).toBe(state);
	});
});

describe("reconcileSelection: referential stability for unchanged entities", () => {
	it("returns the identical selection reference when every scope is still live", () => {
		const project = createSliceFixtureProject();
		const track = project.song.tracks[0];
		const clip = project.clips[0];
		const placement = project.song.placements[0];
		let state = selectOnly({ kind: "track", id: track.id });
		state = addToSelection(state, { kind: "clip", id: clip.id });
		state = addToSelection(state, { kind: "placement", id: placement.id });

		const reconciled = reconcileSelection(state, project);
		expect(reconciled).toBe(state);
	});

	it("keeps unrelated scope objects reference-equal after a partial deletion", () => {
		const project = createReferenceProject({
			trackCount: 6,
			placementCount: 12,
		});
		const survivingTrack = project.song.tracks[0];
		const deletedTrack = project.song.tracks[1];

		let state = selectOnly({ kind: "track", id: survivingTrack.id });
		const survivingScope = state.scopes[0];
		state = addToSelection(state, { kind: "track", id: deletedTrack.id });

		const prunedProject: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.filter((t) => t.id !== deletedTrack.id),
			},
		};

		const reconciled = reconcileSelection(state, prunedProject);
		expect(reconciled.scopes).toEqual([
			{ kind: "track", id: survivingTrack.id },
		]);
		expect(reconciled.scopes[0]).toBe(survivingScope);
	});
});

describe("reconcileSelection: deleted selections", () => {
	function expectDropped(
		project: Project,
		scope: SelectionScope,
		mutate: (project: Project) => Project,
	) {
		const state = selectOnly(scope);
		const mutated = mutate(project);
		const reconciled = reconcileSelection(state, mutated);
		expect(isEmptySelection(reconciled)).toBe(true);
	}

	it("drops a track scope once the track is deleted", () => {
		const project = createSliceFixtureProject();
		const track = project.song.tracks[0];
		expectDropped(project, { kind: "track", id: track.id }, (p) => ({
			...p,
			song: { ...p.song, tracks: [] },
			clips: [],
		}));
	});

	it("drops a clip scope once the clip is deleted", () => {
		const project = createSliceFixtureProject();
		const clip = project.clips[0];
		expectDropped(project, { kind: "clip", id: clip.id }, (p) => ({
			...p,
			clips: [],
			song: { ...p.song, placements: [] },
		}));
	});

	it("drops a placement scope once the placement is deleted", () => {
		const project = createSliceFixtureProject();
		const placement = project.song.placements[0];
		expectDropped(project, { kind: "placement", id: placement.id }, (p) => ({
			...p,
			song: { ...p.song, placements: [] },
		}));
	});

	it("drops an event scope once the note event is deleted", () => {
		const project = createDrumMachineFixtureProject();
		const drumClip = requireDefined(
			project.clips.find((c) => c.content.kind === "notes"),
			"expected the drum-machine fixture to have a notes clip",
		);
		const event = requireDefined(
			drumClip.content.kind === "notes"
				? drumClip.content.events[0]
				: undefined,
			"expected the notes clip to have at least one event",
		);
		expectDropped(project, { kind: "event", id: event.id }, (p) => ({
			...p,
			clips: p.clips.map((c) =>
				c.id === drumClip.id && c.content.kind === "notes"
					? { ...c, content: { kind: "notes", events: [] } }
					: c,
			),
		}));
	});

	it("drops a section scope once the section is deleted", () => {
		const { project, laneId: _laneId } =
			buildProjectWithDeviceAndAutomation("selection-section");
		const section = project.song.sections[0];
		expectDropped(project, { kind: "section", id: section.id }, (p) => ({
			...p,
			song: { ...p.song, sections: [] },
		}));
	});

	it("drops a device scope once the device is deleted", () => {
		const { project, trackId } =
			buildProjectWithDeviceAndAutomation("selection-device");
		const deviceId = project.song.tracks[0].devices[0].id;
		expectDropped(project, { kind: "device", id: deviceId }, (p) => ({
			...p,
			song: {
				...p.song,
				tracks: p.song.tracks.map((t) =>
					t.id === trackId ? { ...t, devices: [] } : t,
				),
			},
		}));
	});

	it("drops an automationPoint scope once its point is removed", () => {
		const { project, laneId } = buildProjectWithDeviceAndAutomation(
			"selection-automation",
		);
		const point = project.song.automation[0].points[1];
		expectDropped(
			project,
			{ kind: "automationPoint", laneId, tick: point.tick },
			(p) => ({
				...p,
				song: {
					...p.song,
					automation: p.song.automation.map((lane) =>
						lane.id === laneId ? { ...lane, points: [lane.points[0]] } : lane,
					),
				},
			}),
		);
	});

	it("drops an automationPoint scope once its whole lane is removed", () => {
		const { project, laneId } = buildProjectWithDeviceAndAutomation(
			"selection-automation-lane",
		);
		const point = project.song.automation[0].points[0];
		expectDropped(
			project,
			{ kind: "automationPoint", laneId, tick: point.tick },
			(p) => ({ ...p, song: { ...p.song, automation: [] } }),
		);
	});

	it("re-focuses the last remaining scope when the focused scope is deleted", () => {
		const project = createSliceFixtureProject();
		const track = project.song.tracks[0];
		const placement = project.song.placements[0];
		let state = selectOnly({ kind: "placement", id: placement.id });
		state = addToSelection(state, { kind: "track", id: track.id });
		// Focus is now the track. Delete the track; the placement scope survives
		// (it references a still-live placement) and becomes the new focus.
		const prunedProject: Project = {
			...project,
			song: { ...project.song, tracks: [] },
		};
		const reconciled = reconcileSelection(state, prunedProject);
		expect(reconciled.scopes).toEqual([
			{ kind: "placement", id: placement.id },
		]);
		expect(reconciled.focus).toEqual({ kind: "placement", id: placement.id });
	});
});

describe("reconcileSelection: bar-range scopes", () => {
	it("narrows a track-scoped bar range when only some tracks survive", () => {
		const project = createReferenceProject({
			trackCount: 4,
			placementCount: 8,
		});
		const [trackA, trackB] = project.song.tracks;
		const state = selectOnly({
			kind: "barRange",
			startTicks: toTicks(0),
			endTicks: toTicks(TICKS_PER_BAR * 4),
			trackIds: [trackA.id, trackB.id],
		});
		const prunedProject: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.filter((t) => t.id !== trackB.id),
			},
		};
		const reconciled = reconcileSelection(state, prunedProject);
		expect(reconciled.scopes).toEqual([
			{
				kind: "barRange",
				startTicks: toTicks(0),
				endTicks: toTicks(TICKS_PER_BAR * 4),
				trackIds: [trackA.id],
			},
		]);
	});

	it("drops a track-scoped bar range once every referenced track is gone", () => {
		const project = createReferenceProject({
			trackCount: 2,
			placementCount: 4,
		});
		const [trackA, trackB] = project.song.tracks;
		const state = selectOnly({
			kind: "barRange",
			startTicks: toTicks(0),
			endTicks: toTicks(TICKS_PER_BAR),
			trackIds: [trackA.id, trackB.id],
		});
		const prunedProject: Project = {
			...project,
			song: { ...project.song, tracks: [] },
		};
		expect(isEmptySelection(reconcileSelection(state, prunedProject))).toBe(
			true,
		);
	});

	it("leaves an all-tracks bar range (no track IDs) untouched by track deletion", () => {
		const project = createReferenceProject({
			trackCount: 3,
			placementCount: 6,
		});
		const state = selectOnly({
			kind: "barRange",
			startTicks: toTicks(0),
			endTicks: toTicks(TICKS_PER_BAR),
			trackIds: [],
		});
		const prunedProject: Project = {
			...project,
			song: { ...project.song, tracks: [] },
		};
		expect(reconcileSelection(state, prunedProject)).toBe(state);
	});

	it("dedupes two bar ranges that converge on the same track set after narrowing", () => {
		const project = createReferenceProject({
			trackCount: 3,
			placementCount: 6,
		});
		const [trackA, trackB, trackC] = project.song.tracks;
		const range = {
			kind: "barRange" as const,
			startTicks: toTicks(0),
			endTicks: toTicks(TICKS_PER_BAR),
		};
		// Two distinct scopes: {A, B} and {A, C}. Deleting B and C narrows both
		// down to the identical {A} scope.
		const state = addToSelection(
			selectOnly({ ...range, trackIds: [trackA.id, trackB.id] }),
			{ ...range, trackIds: [trackA.id, trackC.id] },
		);
		expect(state.scopes).toHaveLength(2);

		const prunedProject: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.filter((t) => t.id === trackA.id),
			},
		};
		const reconciled = reconcileSelection(state, prunedProject);

		expect(reconciled.scopes).toEqual([{ ...range, trackIds: [trackA.id] }]);
		// Focus (originally the second scope) still resolves to the one
		// surviving, deduped instance rather than falling through to a stale key.
		expect(reconciled.focus).toBe(reconciled.scopes[0]);
	});
});

describe("reconcileSelection: reorder", () => {
	it("keeps a track selection valid after reordering tracks", () => {
		const project = createReferenceProject({
			trackCount: 4,
			placementCount: 8,
		});
		const [first, second] = project.song.tracks;
		const state = selectOnly({ kind: "track", id: second.id });

		const reordered: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.map((track) => {
					if (track.id === first.id) return { ...track, order: 1 };
					if (track.id === second.id) return { ...track, order: 0 };
					return track;
				}),
			},
		};

		expect(reconcileSelection(state, reordered)).toBe(state);
	});

	it("keeps a section selection valid after reordering sections", () => {
		const { project } =
			buildProjectWithDeviceAndAutomation("selection-reorder");
		const section = project.song.sections[0];
		const state = selectOnly({ kind: "section", id: section.id });
		const reordered: Project = {
			...project,
			song: {
				...project.song,
				sections: [{ ...section, startTicks: toTicks(TICKS_PER_BAR * 4) }],
			},
		};
		expect(reconcileSelection(state, reordered)).toBe(state);
	});
});

describe("reconcileSelection: large fixtures", () => {
	it("reconciles a large multi-selection against the 50-track reference project", () => {
		const project = createReferenceProject();
		let state = emptySelection();
		for (const track of project.song.tracks.slice(0, 10)) {
			state = addToSelection(state, { kind: "track", id: track.id });
		}
		for (const placement of project.song.placements.slice(0, 25)) {
			state = addToSelection(state, { kind: "placement", id: placement.id });
		}
		for (const lane of project.song.automation.slice(0, 5)) {
			state = addToSelection(state, {
				kind: "automationPoint",
				laneId: lane.id,
				tick: lane.points[0].tick,
			});
		}

		expect(reconcileSelection(state, project)).toBe(state);
		expect(state.scopes).toHaveLength(40);

		const deletedTrackId = project.song.tracks[0].id;
		const survivingPlacements = project.song.placements.filter(
			(placement) => placement.trackId !== deletedTrackId,
		);
		const prunedProject: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.filter((t) => t.id !== deletedTrackId),
				placements: survivingPlacements,
			},
		};
		const reconciled = reconcileSelection(state, prunedProject);
		expect(reconciled).not.toBe(state);
		for (const scope of reconciled.scopes) {
			if (scope.kind === "track" || scope.kind === "placement") {
				expect(scope.id).not.toBe(deletedTrackId);
			}
		}
	});
});

describe("buildSelectionEntityIndex", () => {
	it("indexes every selectable entity kind", () => {
		const { project } = buildProjectWithDeviceAndAutomation("selection-index");
		const index = buildSelectionEntityIndex(project);
		expect(index.projectId).toBe(project.metadata.id);
		expect(index.trackIds.has(project.song.tracks[0].id)).toBe(true);
		expect(index.clipIds.has(project.clips[0].id)).toBe(true);
		expect(index.placementIds.has(project.song.placements[0].id)).toBe(true);
		expect(index.sectionIds.has(project.song.sections[0].id)).toBe(true);
		expect(index.deviceIds.has(project.song.tracks[0].devices[0].id)).toBe(
			true,
		);
		expect(
			index.automationPointTicks
				.get(project.song.automation[0].id)
				?.has(project.song.automation[0].points[0].tick),
		).toBe(true);
	});
});
