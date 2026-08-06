import { describe, expect, it } from "vitest";
import {
	createDenseStepFixtureProject,
	createDrumMachineFixtureProject,
	createPianoRollFixtureProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import { TICKS_PER_BAR, TICKS_PER_QUARTER } from "../domain/time";
import {
	addedPackIds,
	drumTrack,
	editedClip,
	editedInstrument,
	editedTrack,
	instrumentPanelTrackId,
	loopClips,
	packDependencyLabel,
	playheadLabel,
	replacementOptions,
	sampleAssets,
	sampleName,
	showPianoRoll,
} from "./editorViewModel";

/**
 * `editorViewModel` is the pure half of `EditorView`: every derivation the
 * editor's memos wrap. These exercise them directly against the reference
 * fixtures — no rendering, no Solid — including the null-project path each one
 * has to answer while a project is still loading.
 */

describe("addedPackIds", () => {
	it("unions the project's derived dependencies with the session's additions", () => {
		const project = createSliceFixtureProject();
		const projectPackId = project.metadata.packDependencies[0].packId;

		expect(addedPackIds(project, [])).toEqual([projectPackId]);
		expect(addedPackIds(project, ["pak_session"])).toEqual([
			projectPackId,
			"pak_session",
		]);
	});

	it("de-duplicates a session addition the project already depends on", () => {
		const project = createSliceFixtureProject();
		const projectPackId = project.metadata.packDependencies[0].packId;
		expect(addedPackIds(project, [projectPackId])).toEqual([projectPackId]);
	});

	it("returns only the session's packs with no project open", () => {
		expect(addedPackIds(null, [])).toEqual([]);
		expect(addedPackIds(null, ["pak_session"])).toEqual(["pak_session"]);
	});
});

describe("playheadLabel", () => {
	it("shows a 1-based bar.beat, dropping the sixteenth fraction", () => {
		// Tick 0 is the very start: bar 1, beat 1.
		expect(playheadLabel(0)).toBe("1.1");
		// One quarter in is still bar 1, but beat 2.
		expect(playheadLabel(TICKS_PER_QUARTER)).toBe("1.2");
		expect(playheadLabel(TICKS_PER_QUARTER * 3)).toBe("1.4");
		// A whole bar in rolls over to bar 2, beat 1.
		expect(playheadLabel(TICKS_PER_BAR)).toBe("2.1");
		expect(playheadLabel(TICKS_PER_BAR * 4 + TICKS_PER_QUARTER * 2)).toBe(
			"5.3",
		);
	});

	it("ignores a sub-beat offset rather than rounding it up", () => {
		expect(playheadLabel(TICKS_PER_QUARTER + 1)).toBe("1.2");
	});
});

describe("editedTrack", () => {
	it("is the project's first track", () => {
		const project = createSliceFixtureProject();
		expect(editedTrack(project)?.id).toBe(project.song.tracks[0].id);
		expect(editedTrack(project)?.name).toBe("BD");
	});

	it("is null with no project open", () => {
		expect(editedTrack(null)).toBeNull();
	});
});

describe("drumTrack", () => {
	it("finds the first drum-machine track", () => {
		const project = createDrumMachineFixtureProject();
		const found = drumTrack(project);
		expect(found?.instrument?.kind).toBe("drumMachine");
		expect(found?.name).toBe("Drums");
	});

	it("is null for a sampler-only project and with no project open", () => {
		expect(drumTrack(createSliceFixtureProject())).toBeNull();
		expect(drumTrack(null)).toBeNull();
	});
});

describe("sampleAssets", () => {
	it("keeps only `sample`-kind assets, dropping loops", () => {
		const project = createDrumMachineFixtureProject();
		// The drum fixture carries two one-shots plus one `loop`-kind asset.
		const assets = sampleAssets(project);
		expect(assets.map((asset) => asset.name)).toEqual([
			"909 Bass Drum",
			"909 Clap",
		]);
		expect(assets.every((asset) => asset.kind === "sample")).toBe(true);
	});

	it("is empty with no project open", () => {
		expect(sampleAssets(null)).toEqual([]);
	});
});

describe("editedClip", () => {
	it("is the clip on the edited track", () => {
		const project = createSliceFixtureProject();
		const clip = editedClip(project);
		expect(clip?.id).toBe(project.clips[0].id);
		expect(clip?.trackId).toBe(project.song.tracks[0].id);
	});

	it("picks the drum track's clip, not the audio track's loop", () => {
		const project = createDrumMachineFixtureProject();
		const clip = editedClip(project);
		expect(clip?.content.kind).toBe("notes");
		expect(clip?.trackId).toBe(project.song.tracks[0].id);
	});

	it("is null with no project open", () => {
		expect(editedClip(null)).toBeNull();
	});
});

describe("editedInstrument", () => {
	it("is the first track's instrument", () => {
		expect(editedInstrument(createSliceFixtureProject())?.kind).toBe("sampler");
		expect(editedInstrument(createDrumMachineFixtureProject())?.kind).toBe(
			"drumMachine",
		);
		expect(editedInstrument(createPianoRollFixtureProject())?.kind).toBe(
			"synth",
		);
	});

	it("is null with no project open", () => {
		expect(editedInstrument(null)).toBeNull();
	});
});

describe("loopClips", () => {
	it("pairs each audio-loop clip with its resolved asset", () => {
		const project = createDrumMachineFixtureProject();
		const entries = loopClips(project);
		expect(entries).toHaveLength(1);
		expect(entries[0].clip.content.kind).toBe("audioLoop");
		expect(entries[0].asset?.name).toBe("Break loop");
		expect(entries[0].asset?.kind).toBe("loop");
	});

	it("reports a null asset when the loop's asset is missing", () => {
		const project = createDrumMachineFixtureProject();
		const withoutAssets = {
			...project,
			song: { ...project.song, assets: [] },
		};
		expect(loopClips(withoutAssets)[0].asset).toBeNull();
	});

	it("is empty for a project with no loops, and with no project open", () => {
		expect(loopClips(createSliceFixtureProject())).toEqual([]);
		expect(loopClips(null)).toEqual([]);
	});
});

describe("sampleName", () => {
	it("names the sample the edited sampler is loaded with", () => {
		expect(sampleName(createSliceFixtureProject())).toBe("909 Bass Drum");
	});

	it("is null when the edited instrument is not a sampler", () => {
		expect(sampleName(createDrumMachineFixtureProject())).toBeNull();
		expect(sampleName(createPianoRollFixtureProject())).toBeNull();
		expect(sampleName(null)).toBeNull();
	});
});

describe("replacementOptions", () => {
	it("offers every `sample`-kind asset as an id/name choice", () => {
		const project = createDenseStepFixtureProject();
		expect(replacementOptions(project).map((choice) => choice.name)).toEqual([
			"909 Bass Drum",
			"909 Snare",
			"909 Closed Hat",
		]);
		expect(replacementOptions(project)[0].assetId).toBe(
			project.song.assets[0].id,
		);
	});

	it("excludes loop assets, matching sampleAssets", () => {
		const project = createDrumMachineFixtureProject();
		expect(replacementOptions(project)).toHaveLength(
			sampleAssets(project).length,
		);
	});

	it("is empty with no project open", () => {
		expect(replacementOptions(null)).toEqual([]);
	});
});

describe("packDependencyLabel", () => {
	it("labels the project's first pack dependency as `id @ version`", () => {
		const project = createSliceFixtureProject();
		const dependency = project.metadata.packDependencies[0];
		expect(packDependencyLabel(project)).toBe(
			`${dependency.packId} @ ${dependency.version}`,
		);
	});

	it("is null for a project with no pack dependency, and with none open", () => {
		// The piano-roll fixture is the synth-only, pack-free fixture.
		expect(createPianoRollFixtureProject().metadata.packDependencies).toEqual(
			[],
		);
		expect(packDependencyLabel(createPianoRollFixtureProject())).toBeNull();
		expect(packDependencyLabel(null)).toBeNull();
	});
});

describe("showPianoRoll", () => {
	it("is true for a synth track holding a note clip", () => {
		expect(showPianoRoll(createPianoRollFixtureProject())).toBe(true);
	});

	it("is false for a sampler or drum-machine note clip, which get the step grid", () => {
		expect(showPianoRoll(createSliceFixtureProject())).toBe(false);
		expect(showPianoRoll(createDrumMachineFixtureProject())).toBe(false);
	});

	it("is false for a synth track with no clip", () => {
		const project = createPianoRollFixtureProject();
		expect(showPianoRoll({ ...project, clips: [] })).toBe(false);
	});

	it("is false with no project open", () => {
		expect(showPianoRoll(null)).toBe(false);
	});
});

describe("instrumentPanelTrackId", () => {
	it("names the track for a sampler or a synth", () => {
		const sampler = createSliceFixtureProject();
		expect(instrumentPanelTrackId(sampler)).toBe(sampler.song.tracks[0].id);
		const synth = createPianoRollFixtureProject();
		expect(instrumentPanelTrackId(synth)).toBe(synth.song.tracks[0].id);
	});

	it("names a drum-machine track too, so the kind picker can leave it (#224)", () => {
		const drums = createDrumMachineFixtureProject();
		expect(instrumentPanelTrackId(drums)).toBe(drums.song.tracks[0].id);
	});

	it("is null with no project open", () => {
		expect(instrumentPanelTrackId(null)).toBeNull();
	});
});
