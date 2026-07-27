import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./entities";
import { createBlankProject } from "./factories";
import {
	ARRANGEMENT_SPIKE_TRACK_COUNTS,
	createArrangementSpikeFixtures,
	createArrangementSpikeProject,
	createDrumMachineFixtureProject,
	createReferenceProject,
	createSliceFixtureProject,
	drumMachineFixturePacks,
	sliceFixturePacks,
} from "./fixtures";
import { createSeededIdFactory, idPattern } from "./ids";
import { derivePackDependencies } from "./packs";
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

	it("depends on no packs, because it references no assets", () => {
		const project = createBlankProject({ ownerId: "user_1" });
		expect(project.metadata.packDependencies).toEqual([]);
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

	describe("packs", () => {
		it("gives the slice fixture one pack its sampler asset resolves from", () => {
			const project = createSliceFixtureProject();
			const packs = sliceFixturePacks();

			expect(project.metadata.packDependencies).toEqual([
				{ packId: packs.drums.id, version: packs.drums.version },
			]);
			expect(project.song.assets[0].packId).toBe(packs.drums.id);
		});

		it("spans two packs at two versions in the drum-machine fixture", () => {
			const project = createDrumMachineFixtureProject();
			const packs = drumMachineFixturePacks();

			expect(parseProject(project).ok).toBe(true);
			expect(project.metadata.packDependencies).toHaveLength(2);
			expect(project.metadata.packDependencies).toEqual(
				derivePackDependencies(project.song),
			);
			expect(new Set(project.song.assets.map((asset) => asset.packId))).toEqual(
				new Set([packs.drums.id, packs.loops.id]),
			);
			expect(packs.drums.version).not.toBe(packs.loops.version);
		});

		it("spans two packs in the reference arrangement once it has waveform tracks", () => {
			const oneTrackType = createReferenceProject({ trackCount: 6 });
			expect(oneTrackType.metadata.packDependencies).toHaveLength(1);

			const withWaveforms = createReferenceProject({
				trackCount: 6,
				waveformTrackCount: 2,
			});
			expect(parseProject(withWaveforms).ok).toBe(true);
			expect(withWaveforms.metadata.packDependencies).toHaveLength(2);
		});

		it("keeps every fixture's dependency list derived, not hand-written", () => {
			for (const project of [
				createSliceFixtureProject(),
				createDrumMachineFixtureProject(),
				createReferenceProject({ trackCount: 4, waveformTrackCount: 2 }),
				...ARRANGEMENT_SPIKE_TRACK_COUNTS.map((count) =>
					createArrangementSpikeProject(count),
				),
			]) {
				expect(
					project.metadata.packDependencies,
					project.metadata.name,
				).toEqual(derivePackDependencies(project.song));
			}
		});

		it("replays the same pack ids for the same fixture seed", () => {
			expect(drumMachineFixturePacks()).toEqual(drumMachineFixturePacks());
			expect(drumMachineFixturePacks({ seed: "other" })).not.toEqual(
				drumMachineFixturePacks(),
			);
		});
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
			// Density, not just "more than one per track": must match the PRD 9.3
			// reference arrangement's 50 placements/track (50 tracks * 50 = 2,500,
			// its "at least 2,500 clip placements"), so a future change can't
			// silently thin the fixture back to an unrepresentative benchmark.
			expect(project.song.placements.length).toBeGreaterThanOrEqual(
				trackCount * 50,
			);
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
