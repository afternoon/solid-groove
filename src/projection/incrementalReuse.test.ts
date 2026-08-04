/**
 * HARD-006 performance regression guard.
 *
 * Both projection builders are on the per-edit hot path: `useProjectAudio`
 * rebuilds the audio projection on every project change, and the arrangement
 * renderer rebuilds its projection whenever the project revision moves. The
 * PRD's section 9.3 acceptance requires "frame cost proportional primarily to
 * visible objects, not total project duration or total offscreen clips", and
 * section 10 targets a 50 ms pointer-edit response on the 50-track reference
 * project.
 *
 * Domain edits share structure (`src/commands/projectEdits.ts`: "a note edit
 * on a 50-track project leaves 49 track objects referentially identical"), so
 * an incremental rebuild after a one-entity edit should do fingerprint work
 * for *that* entity only. This test proves it: it counts `fingerprintOf` calls
 * across an incremental rebuild and asserts the count scales with the number
 * of *changed* entities, not the project size. Before the object-identity fast
 * path, every rebuild re-fingerprinted every track, clip, placement, section,
 * automation lane, return, and asset — so a one-note edit on the 50-track
 * reference project ran thousands of stable-stringify+hash passes it did not
 * need. This guard fails if that regresses.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let fingerprintCalls = 0;

vi.mock("./fingerprint", async () => {
	const actual =
		await vi.importActual<typeof import("./fingerprint")>("./fingerprint");
	return {
		...actual,
		fingerprintOf: (value: unknown) => {
			fingerprintCalls += 1;
			return actual.fingerprintOf(value);
		},
	};
});

import type { Placement, Project, Track } from "../domain/entities";
import { createReferenceProject } from "../domain/fixtures";
import { buildArrangementProjection } from "./arrangementProjection";
import { buildAudioProjection } from "./audioProjection";

beforeEach(() => {
	fingerprintCalls = 0;
});

/**
 * The PRD 9.3 reference arrangement: 50 tracks, ten minutes, 2,500 placements,
 * 100 automation lanes. Built once — the point of these tests is what a rebuild
 * costs, and building it is not what we measure.
 */
function referenceProject(): Project {
	return createReferenceProject();
}

/**
 * Immutable edits with the same structural sharing the command layer produces
 * (`src/commands/projectEdits.ts`): a new object along the changed path, every
 * untouched object reused by reference. Written out by hand here rather than
 * with `solid-js/store`'s `produce`, which mutates a plain object in place and
 * so would not reproduce the identity-sharing the fast path relies on.
 */
function replaceTrack(project: Project, next: Track): Project {
	return {
		...project,
		metadata: { ...project.metadata, revision: project.metadata.revision + 1 },
		song: {
			...project.song,
			tracks: project.song.tracks.map((track) =>
				track.id === next.id ? next : track,
			),
		},
	};
}

function replacePlacement(project: Project, next: Placement): Project {
	return {
		...project,
		metadata: { ...project.metadata, revision: project.metadata.revision + 1 },
		song: {
			...project.song,
			placements: project.song.placements.map((placement) =>
				placement.id === next.id ? next : placement,
			),
		},
	};
}

describe("audio projection incremental rebuild", () => {
	it("re-fingerprints nothing when the project object is unchanged", () => {
		const project = referenceProject();
		const before = buildAudioProjection(project);
		fingerprintCalls = 0;

		// Same project object, same entity references throughout.
		const after = buildAudioProjection(project, before);

		expect(fingerprintCalls).toBe(0);
		expect(after.tracks).toEqual(before.tracks);
		// Every entry is reused by reference.
		for (let i = 0; i < after.tracks.length; i += 1) {
			expect(after.tracks[i]).toBe(before.tracks[i]);
		}
	});

	it("re-fingerprints only the one edited track, not the other 49", () => {
		const project = referenceProject();
		const before = buildAudioProjection(project);

		// Edit exactly one track's mixer, immutably — every other track keeps its
		// object reference (structural sharing).
		const target = project.song.tracks[10];
		const edited = replaceTrack(project, {
			...target,
			mixer: { ...target.mixer, volume: -12 },
		});
		expect(edited.song.tracks[10]).not.toBe(target);
		expect(edited.song.tracks[0]).toBe(project.song.tracks[0]);

		fingerprintCalls = 0;
		const after = buildAudioProjection(edited, before);

		// One track fingerprints two shapes (full + topology). Nothing else does.
		expect(fingerprintCalls).toBe(2);

		// The edited track is a fresh entry; every other track is reused.
		const editedId = edited.song.tracks[10].id;
		expect(after.tracksById.get(editedId)).not.toBe(
			before.tracksById.get(editedId),
		);
		for (const track of edited.song.tracks) {
			if (track.id === editedId) continue;
			expect(after.tracksById.get(track.id)).toBe(
				before.tracksById.get(track.id),
			);
		}
	});
});

describe("arrangement projection incremental rebuild", () => {
	it("re-fingerprints nothing when the project object is unchanged", () => {
		const project = referenceProject();
		const before = buildArrangementProjection(project);
		fingerprintCalls = 0;

		const after = buildArrangementProjection(project, before);

		expect(fingerprintCalls).toBe(0);
		for (let i = 0; i < after.placements.length; i += 1) {
			expect(after.placements[i]).toBe(before.placements[i]);
		}
	});

	it("re-fingerprints only the one edited placement, not all 2,500", () => {
		const project = referenceProject();
		const before = buildArrangementProjection(project);
		expect(before.placements.length).toBeGreaterThanOrEqual(2500);

		const target = project.song.placements[100];
		const edited = replacePlacement(project, {
			...target,
			startTicks: (target.startTicks + 192) as typeof target.startTicks,
		});
		expect(edited.song.placements[100]).not.toBe(target);

		fingerprintCalls = 0;
		const after = buildArrangementProjection(edited, before);

		// Exactly one placement is re-fingerprinted.
		expect(fingerprintCalls).toBe(1);

		const editedId = edited.song.placements[100].id;
		expect(after.placementsById.get(editedId)).not.toBe(
			before.placementsById.get(editedId),
		);
		for (const placement of edited.song.placements) {
			if (placement.id === editedId) continue;
			expect(after.placementsById.get(placement.id)).toBe(
				before.placementsById.get(placement.id),
			);
		}
	});

	it("still detects a change when a track rename shifts row layout", () => {
		// A row's fingerprint depends on layout position, not just the track
		// object. This guards the one dep-list that carries scalars: renaming a
		// track must still produce a fresh row (its name changed) even though the
		// fast path keys partly on identity.
		const project = referenceProject();
		const before = buildArrangementProjection(project);

		const edited = replaceTrack(project, {
			...project.song.tracks[0],
			name: "Renamed",
		});

		const after = buildArrangementProjection(edited, before);
		const rowId = edited.song.tracks[0].id;
		expect(after.rowsById.get(rowId)).not.toBe(before.rowsById.get(rowId));
		expect(after.rowsById.get(rowId)?.name).toBe("Renamed");
	});
});
