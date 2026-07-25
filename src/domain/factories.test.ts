import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./entities";
import { createBlankProject } from "./factories";
import {
	ARRANGEMENT_SPIKE_TRACK_COUNTS,
	createArrangementSpikeFixtures,
	createArrangementSpikeProject,
	createReferenceProject,
	createSliceFixtureProject,
} from "./fixtures";
import { createSeededIdFactory, idPattern } from "./ids";
import { MASTER_VOLUME, SONG_TEMPO } from "./parameters";
import { isProject, parseProject } from "./parse";
import { minutesToTicks, TICKS_PER_BAR } from "./time";

describe("blank project factory", () => {
	it("produces a valid, empty schema-v1 project", () => {
		const project = createBlankProject({ ownerId: "user_1" });

		expect(isProject(project)).toBe(true);
		expect(project.metadata.schemaVersion).toBe(SCHEMA_VERSION);
		expect(project.metadata.revision).toBe(0);
		expect(project.metadata.id).toMatch(idPattern("project"));
		expect(project.song.tempo).toBe(SONG_TEMPO.defaultValue);
		expect(project.song.master.volume).toBe(MASTER_VOLUME.defaultValue);
		expect(project.song.tracks).toEqual([]);
		expect(project.clips).toEqual([]);
	});

	it("keeps Firebase and audio types out of the domain", () => {
		const project = createBlankProject({ ownerId: "user_1", now: 1_700_000 });
		expect(typeof project.metadata.createdAt).toBe("number");
		expect(typeof project.metadata.modifiedAt).toBe("number");
		expect(JSON.parse(JSON.stringify(project)).metadata.createdAt).toBe(
			1_700_000,
		);
	});

	it("produces independent projects that share no mutable state", () => {
		const first = createBlankProject({ ownerId: "user_1" });
		const second = createBlankProject({ ownerId: "user_1" });

		expect(second.metadata.id).not.toBe(first.metadata.id);
		expect(second.song).not.toBe(first.song);

		second.song.tracks.push(createSliceFixtureProject().song.tracks[0]);
		expect(first.song.tracks).toHaveLength(0);
	});

	it("takes an injected clock and id factory for deterministic state", () => {
		const options = {
			ownerId: "user_1",
			name: "Seeded",
			ids: createSeededIdFactory("blank"),
			now: 1_234_567,
		};
		const first = createBlankProject(options);
		const second = createBlankProject({
			...options,
			ids: createSeededIdFactory("blank"),
		});

		expect(second).toEqual(first);
		expect(first.metadata.createdAt).toBe(1_234_567);
	});

	it("clamps an out-of-range tempo through the shared parameter definition", () => {
		expect(
			createBlankProject({ ownerId: "user_1", tempo: 5_000 }).song.tempo,
		).toBe(SONG_TEMPO.max);
	});
});

describe("fixtures", () => {
	it("builds the slice fixture: a sampler track, a one-bar clip, one placement", () => {
		const project = createSliceFixtureProject();

		expect(parseProject(project).ok).toBe(true);
		expect(project.song.tracks).toHaveLength(1);
		expect(project.song.tracks[0].instrument?.kind).toBe("sampler");
		expect(project.clips).toHaveLength(1);
		expect(project.clips[0].lengthTicks).toBe(TICKS_PER_BAR);
		expect(project.song.placements).toHaveLength(1);
		if (project.clips[0].content.kind === "notes") {
			expect(project.clips[0].content.events).toHaveLength(4);
		}
	});

	it("is deterministic and independent across calls", () => {
		const first = createSliceFixtureProject();
		const second = createSliceFixtureProject();

		expect(second).toEqual(first);
		expect(second.song.tracks[0]).not.toBe(first.song.tracks[0]);

		second.song.tracks[0].name = "changed";
		expect(first.song.tracks[0].name).toBe("BD");
	});

	it("varies ids by seed while staying valid", () => {
		const other = createSliceFixtureProject({ seed: "another" });
		expect(other.metadata.id).not.toBe(createSliceFixtureProject().metadata.id);
		expect(isProject(other)).toBe(true);
	});

	it("builds the PRD reference arrangement at ten-minute bounds", () => {
		const project = createReferenceProject();
		const lengthTicks = minutesToTicks(10, project.song.tempo);

		expect(parseProject(project).ok).toBe(true);
		expect(project.song.tracks).toHaveLength(50);
		expect(project.song.placements.length).toBeGreaterThanOrEqual(2_500);
		expect(project.song.automation).toHaveLength(100);
		expect(project.clips).toHaveLength(50);

		const lastTick = Math.max(
			...project.song.placements.map(
				(placement) => placement.startTicks + placement.durationTicks,
			),
		);
		expect(lastTick).toBeLessThanOrEqual(lengthTicks);
		expect(lengthTicks).toBe(230_400);
	});

	it("scales down to a smaller arrangement without breaking invariants", () => {
		const small = createReferenceProject({
			trackCount: 4,
			minutes: 1,
			placementCount: 16,
			automationLaneCount: 4,
		});
		expect(parseProject(small).ok).toBe(true);
		expect(small.song.tracks).toHaveLength(4);
	});

	it("adds audio tracks with audioLoop clips when waveformTrackCount is set", () => {
		const project = createReferenceProject({
			trackCount: 10,
			waveformTrackCount: 4,
		});
		expect(parseProject(project).ok).toBe(true);

		const audioTracks = project.song.tracks.filter(
			(track) => track.type === "audio",
		);
		expect(audioTracks).toHaveLength(4);
		expect(audioTracks.every((track) => track.instrument === null)).toBe(true);

		const clipsByTrack = new Map(
			project.clips.map((clip) => [clip.trackId, clip]),
		);
		for (const track of audioTracks) {
			expect(clipsByTrack.get(track.id)?.content.kind).toBe("audioLoop");
		}
		const instrumentTracks = project.song.tracks.filter(
			(track) => track.type === "instrument",
		);
		for (const track of instrumentTracks) {
			expect(clipsByTrack.get(track.id)?.content.kind).toBe("notes");
		}
		// The waveform-bearing asset is registered on the song, not orphaned.
		const audioLoopAssetIds = new Set(
			project.clips
				.map((clip) => clip.content)
				.filter((content) => content.kind === "audioLoop")
				.map((content) => content.assetId),
		);
		for (const assetId of audioLoopAssetIds) {
			expect(project.song.assets.some((asset) => asset.id === assetId)).toBe(
				true,
			);
		}
	});
});

describe("FND-008 arrangement spike fixtures", () => {
	it.each(ARRANGEMENT_SPIKE_TRACK_COUNTS)(
		"builds a valid, ten-minute, dense, automated %i-track arrangement",
		(trackCount) => {
			const project = createArrangementSpikeProject(trackCount);
			const lengthTicks = minutesToTicks(10, project.song.tempo);

			expect(parseProject(project).ok).toBe(true);
			expect(project.song.tracks).toHaveLength(trackCount);
			expect(project.song.placements.length).toBeGreaterThan(trackCount);
			expect(project.song.automation.length).toBeGreaterThan(0);

			const waveformTracks = project.song.tracks.filter(
				(track) => track.type === "audio",
			);
			expect(waveformTracks.length).toBeGreaterThan(0);

			const lastTick = Math.max(
				...project.song.placements.map(
					(placement) => placement.startTicks + placement.durationTicks,
				),
			);
			expect(lastTick).toBeLessThanOrEqual(lengthTicks);
		},
	);

	it("is deterministic across calls at the same track count", () => {
		expect(createArrangementSpikeProject(20)).toEqual(
			createArrangementSpikeProject(20),
		);
	});

	it("builds all three benchmark track counts keyed by count", () => {
		const fixtures = createArrangementSpikeFixtures();
		for (const trackCount of ARRANGEMENT_SPIKE_TRACK_COUNTS) {
			expect(fixtures[trackCount].song.tracks).toHaveLength(trackCount);
		}
	});
});
