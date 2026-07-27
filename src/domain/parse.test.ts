import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./entities";
import {
	createDrumMachineFixtureProject,
	createSliceFixtureProject,
} from "./fixtures";
import { createSeededIdFactory } from "./ids";
import {
	assertProject,
	type DomainIssueCode,
	DomainValidationError,
	isProject,
	type ParseResult,
	parseClip,
	parseProject,
	parseProjectMetadata,
	parseSong,
} from "./parse";
import { serializeProject } from "./serialize";

/**
 * Every invariant in PRD section 9.5 is exercised by mutating one field of a
 * known-good fixture, so a test failure points at exactly one rule.
 */

type JsonRecord = Record<string, unknown>;

interface MutableProject {
	metadata: JsonRecord & {
		schemaVersion: number;
		createdAt: number;
		modifiedAt: number;
		collaboratorIds: string[];
		packDependencies: { packId: string; version: string }[];
	};
	song: {
		tempo: number;
		timeSignature: JsonRecord;
		tracks: MutableTrack[];
		returns: JsonRecord[];
		master: JsonRecord;
		sections: JsonRecord[];
		placements: MutablePlacement[];
		automation: MutableAutomation[];
		assets: JsonRecord[];
	};
	clips: MutableClip[];
}

interface MutableTrack extends JsonRecord {
	id: string;
	order: number;
	devices: (JsonRecord & { id: string; order: number })[];
	sendConfig: (JsonRecord & { returnId: string })[];
	instrument:
		| (JsonRecord & {
				assetId?: string | null;
				pads?: MutableDrumPad[];
		  })
		| null;
	mixer: JsonRecord & { volume: number };
}

interface MutableDrumPad extends JsonRecord {
	id: string;
	assetId: string | null;
}

interface MutablePlacement extends JsonRecord {
	id: string;
	clipId: string;
	trackId: string;
}

interface MutableAutomation extends JsonRecord {
	id: string;
	target: JsonRecord & { parameterId: string; trackId?: string };
	points: { tick: number; value: number }[];
}

interface MutableClip extends JsonRecord {
	id: string;
	trackId: string;
	lengthTicks: number;
	content: JsonRecord & {
		kind: string;
		assetId?: string;
		events: (JsonRecord & { id: string; startTicks: number })[];
	};
}

const ids = createSeededIdFactory("parse-test");

/** A serialized copy of the fixture: plain JSON, safe to mutate. */
function baseProject(): MutableProject {
	return JSON.parse(
		JSON.stringify(serializeProject(createSliceFixtureProject())),
	) as MutableProject;
}

/** A serialized copy of the drum-machine/audio-loop fixture, safe to mutate. */
function drumMachineProject(): MutableProject {
	return JSON.parse(
		JSON.stringify(serializeProject(createDrumMachineFixtureProject())),
	) as MutableProject;
}

function audioLoopClip(project: MutableProject): MutableClip {
	const clip = project.clips.find(
		(entry) => entry.content.kind === "audioLoop",
	);
	if (!clip) {
		throw new Error("fixture has no audioLoop clip");
	}
	return clip;
}

function drumPads(project: MutableProject): MutableDrumPad[] {
	const pads = project.song.tracks.find(
		(track) => track.instrument?.kind === "drumMachine",
	)?.instrument?.pads;
	if (!pads || pads.length === 0) {
		throw new Error("fixture has no drum pads");
	}
	return pads;
}

function expectIssue<T>(result: ParseResult<T>, code: DomainIssueCode): void {
	expect(result.ok).toBe(false);
	if (result.ok) {
		return;
	}
	expect(
		result.issues.map((issue) => issue.code),
		`issues: ${JSON.stringify(result.issues)}`,
	).toContain(code);
}

describe("parseProject", () => {
	it("accepts the fixture and returns the same state it was given", () => {
		const input = baseProject();
		const result = parseProject(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(serializeProject(result.value)).toEqual(input);
		}
		expect(isProject(input)).toBe(true);
	});

	it("rejects unknown keys rather than silently dropping them", () => {
		const input = baseProject();
		(input.song as JsonRecord).swing = 0.5;
		expectIssue(parseProject(input), "invalid_shape");
	});

	it("refuses a future schema version instead of coercing it to v1", () => {
		const input = baseProject();
		input.metadata.schemaVersion = SCHEMA_VERSION + 1;
		const result = parseProject(input);
		expectIssue(result, "unsupported_schema_version");
		expect(result.ok).toBe(false);
	});

	it("refuses pre-v1 prototype documents", () => {
		const input = baseProject();
		input.metadata.schemaVersion = 0;
		expectIssue(parseProject(input), "unsupported_schema_version");
	});

	it("rejects non-finite numbers", () => {
		const tempo = baseProject();
		tempo.song.tempo = Number.POSITIVE_INFINITY;
		expectIssue(parseProject(tempo), "invalid_shape");

		const volume = baseProject();
		volume.song.tracks[0].mixer.volume = Number.NaN;
		expectIssue(parseProject(volume), "invalid_shape");
	});

	it("rejects floating-point musical time", () => {
		const input = baseProject();
		input.clips[0].content.events[0].startTicks = 24.5;
		expectIssue(parseProject(input), "invalid_shape");
	});

	it("rejects parameter values outside their declared range", () => {
		const input = baseProject();
		input.song.tracks[0].mixer.volume = 40;
		expectIssue(parseProject(input), "invalid_shape");
	});

	it("rejects a placement that references a missing clip", () => {
		const input = baseProject();
		input.song.placements[0].clipId = ids("clip");
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects a placement of a clip owned by a different track", () => {
		const input = baseProject();
		const otherTrack = { ...input.song.tracks[0], id: ids("track"), order: 1 };
		input.song.tracks.push(otherTrack as MutableTrack);
		input.song.placements[0].trackId = otherTrack.id;
		expectIssue(parseProject(input), "cross_owner_reference");
	});

	it("rejects a clip owned by a missing track", () => {
		const input = baseProject();
		const missingTrack = ids("track");
		input.clips[0].trackId = missingTrack;
		input.song.placements[0].trackId = missingTrack;
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects duplicate entity ids anywhere in the aggregate", () => {
		const input = baseProject();
		input.clips.push({ ...input.clips[0] });
		expectIssue(parseProject(input), "duplicate_id");
	});

	it("rejects non-serial track order", () => {
		const input = baseProject();
		input.song.tracks[0].order = 3;
		expectIssue(parseProject(input), "invalid_order");
	});

	it("rejects non-serial insert chains", () => {
		const input = baseProject();
		input.song.tracks[0].devices = [
			device(0, "reverb"),
			device(0, "delay"),
		] as MutableTrack["devices"];
		expectIssue(parseProject(input), "invalid_order");
	});

	it("rejects a send to a missing return bus", () => {
		const input = baseProject();
		input.song.tracks[0].sendConfig = [
			{ returnId: ids("return"), level: 0.5, preFader: false },
		];
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects two sends from one track to the same return bus", () => {
		const input = baseProject();
		const returnId = ids("return");
		input.song.returns = [
			{
				id: returnId,
				name: "Reverb",
				order: 0,
				devices: [],
				mixer: { volume: 0, pan: 0, muted: false },
			},
		];
		input.song.tracks[0].sendConfig = [
			{ returnId, level: 0.5, preFader: false },
			{ returnId, level: 0.2, preFader: false },
		];
		expectIssue(parseProject(input), "duplicate_id");
	});

	it("rejects an instrument or note that references a missing asset or pad", () => {
		const missingAsset = baseProject();
		if (missingAsset.song.tracks[0].instrument) {
			missingAsset.song.tracks[0].instrument.assetId = ids("asset");
		}
		expectIssue(parseProject(missingAsset), "dangling_reference");

		const missingPad = baseProject();
		missingPad.clips[0].content.events[0].trigger = {
			kind: "pad",
			padId: ids("pad"),
		};
		expectIssue(parseProject(missingPad), "dangling_reference");
	});

	it("rejects a note that starts outside its clip", () => {
		const input = baseProject();
		input.clips[0].content.events[0].startTicks = input.clips[0].lengthTicks;
		expectIssue(parseProject(input), "invalid_musical_time");
	});

	it("rejects automation targeting a missing track, unknown parameter, or fixed parameter", () => {
		const missingTrack = baseProject();
		missingTrack.song.automation = [
			lane(ids("automation"), ids("track"), "track.volume"),
		];
		expectIssue(parseProject(missingTrack), "dangling_reference");

		const unknownParameter = baseProject();
		unknownParameter.song.automation = [
			lane(
				ids("automation"),
				unknownParameter.song.tracks[0].id,
				"track.mystery",
			),
		];
		expectIssue(parseProject(unknownParameter), "invalid_automation");

		const fixedParameter = baseProject();
		fixedParameter.song.automation = [
			lane(ids("automation"), fixedParameter.song.tracks[0].id, "song.tempo"),
		];
		expectIssue(parseProject(fixedParameter), "invalid_automation");
	});

	it("rejects automation targeting a device the track does not own", () => {
		const input = baseProject();
		input.song.automation = [
			{
				id: ids("automation"),
				target: {
					scope: "trackDevice",
					trackId: input.song.tracks[0].id,
					deviceId: ids("device"),
					parameterId: "track.volume",
				},
				interpolation: "linear",
				points: [{ tick: 0, value: 0 }],
			},
		];
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects automation targeting a send the track does not have", () => {
		const input = baseProject();
		input.song.automation = [
			{
				id: ids("automation"),
				target: {
					scope: "send",
					trackId: input.song.tracks[0].id,
					returnId: ids("return"),
					parameterId: "track.sendLevel",
				},
				interpolation: "linear",
				points: [{ tick: 0, value: 0 }],
			},
		];
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects automation targeting a missing return bus", () => {
		const input = baseProject();
		input.song.automation = [
			{
				id: ids("automation"),
				target: {
					scope: "return",
					returnId: ids("return"),
					parameterId: "return.volume",
				},
				interpolation: "linear",
				points: [{ tick: 0, value: 0 }],
			},
		];
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects automation points that are unordered or out of range", () => {
		const unordered = baseProject();
		const unorderedLane = lane(
			ids("automation"),
			unordered.song.tracks[0].id,
			"track.volume",
		);
		unorderedLane.points = [
			{ tick: 192, value: 0 },
			{ tick: 0, value: -6 },
		];
		unordered.song.automation = [unorderedLane];
		expectIssue(parseProject(unordered), "invalid_automation");

		const outOfRange = baseProject();
		const outOfRangeLane = lane(
			ids("automation"),
			outOfRange.song.tracks[0].id,
			"track.volume",
		);
		outOfRangeLane.points = [{ tick: 0, value: 40 }];
		outOfRange.song.automation = [outOfRangeLane];
		expectIssue(parseProject(outOfRange), "invalid_parameter");
	});

	it("rejects inconsistent project metadata", () => {
		const timestamps = baseProject();
		timestamps.metadata.modifiedAt = timestamps.metadata.createdAt - 1;
		expectIssue(parseProject(timestamps), "invalid_metadata");

		const collaborators = baseProject();
		collaborators.metadata.collaboratorIds = ["user_a", "user_a"];
		expectIssue(parseProject(collaborators), "duplicate_id");
	});

	it("does not mutate its input when parsing fails", () => {
		const input = baseProject();
		input.song.placements[0].clipId = ids("clip");
		const snapshot = JSON.parse(JSON.stringify(input));

		const result = parseProject(input);

		expect(result.ok).toBe(false);
		expect(input).toEqual(snapshot);
		expect("value" in result).toBe(false);
	});

	it("reports every failing invariant at once rather than the first", () => {
		const input = baseProject();
		input.song.tracks[0].order = 5;
		input.song.placements[0].clipId = ids("clip");
		const result = parseProject(input);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.length).toBeGreaterThanOrEqual(2);
		}
	});

	it("throws a described DomainValidationError from assertProject", () => {
		const input = baseProject();
		input.metadata.schemaVersion = 99;
		expect(() => assertProject(input)).toThrow(DomainValidationError);
		try {
			assertProject(input);
		} catch (error) {
			expect(error).toBeInstanceOf(DomainValidationError);
			expect((error as DomainValidationError).issues[0].code).toBe(
				"unsupported_schema_version",
			);
			expect((error as DomainValidationError).message).toMatch(
				/newer than the supported version/,
			);
		}
	});

	it("rejects values that are not objects at all", () => {
		for (const value of [null, undefined, 42, "project", []]) {
			expect(parseProject(value).ok).toBe(false);
		}
	});
});

describe("audio loop clips and drum pads", () => {
	it("accepts the drum-machine fixture", () => {
		const input = drumMachineProject();
		const result = parseProject(input);
		expect(result.ok, `issues: ${JSON.stringify(result)}`).toBe(true);
		expect(audioLoopClip(input).content.kind).toBe("audioLoop");
		expect(drumPads(input).length).toBeGreaterThan(0);
	});

	it("rejects an audio-loop clip that references a missing asset", () => {
		const input = drumMachineProject();
		audioLoopClip(input).content.assetId = ids("asset");
		expectIssue(parseProject(input), "dangling_reference");
	});

	it("rejects a drum pad that references a missing asset", () => {
		const input = drumMachineProject();
		drumPads(input)[0].assetId = ids("asset");
		expectIssue(parseProject(input), "dangling_reference");
	});
});

/**
 * Invariant 12. Every case mutates one field of a valid fixture, and the
 * two-pack drum-machine fixture is used wherever a single-pack project could
 * pass by accident.
 */
describe("pack-qualified asset identity", () => {
	it("accepts a fixture whose assets span two packs at two versions", () => {
		const input = drumMachineProject();
		const result = parseProject(input);

		expect(result.ok, `issues: ${JSON.stringify(result)}`).toBe(true);
		expect(input.metadata.packDependencies).toHaveLength(2);
		expect(
			new Set(input.metadata.packDependencies.map((entry) => entry.version))
				.size,
		).toBe(2);
	});

	it("rejects an asset with no pack at all", () => {
		const noPackId = baseProject();
		delete noPackId.song.assets[0].packId;
		expectIssue(parseProject(noPackId), "invalid_shape");

		const noPackVersion = baseProject();
		delete noPackVersion.song.assets[0].packVersion;
		expectIssue(parseProject(noPackVersion), "invalid_shape");

		const nullPack = baseProject();
		nullPack.song.assets[0].packId = null;
		expectIssue(parseProject(nullPack), "invalid_shape");
	});

	it("rejects an asset resolving from a pack the project does not declare", () => {
		const input = drumMachineProject();
		input.song.assets[0].packId = ids("pack");
		expectIssue(parseProject(input), "invalid_pack_reference");
	});

	it("rejects an asset resolving from a version the project does not declare", () => {
		const input = drumMachineProject();
		input.song.assets[0].packVersion = "9.9.9";
		expectIssue(parseProject(input), "invalid_pack_reference");
	});

	it("rejects a malformed pack id or version", () => {
		const badId = baseProject();
		badId.song.assets[0].packId = "trk_notapack000000000000";
		expectIssue(parseProject(badId), "invalid_shape");

		const badVersion = baseProject();
		badVersion.song.assets[0].packVersion = "latest";
		expectIssue(parseProject(badVersion), "invalid_shape");
	});

	it("rejects a dependency list holding a pack no asset resolves from", () => {
		const input = baseProject();
		input.metadata.packDependencies = [
			...input.metadata.packDependencies,
			{ packId: ids("pack"), version: "1.0.0" },
		];
		// The list is derived from project state; over-reporting is drift, not
		// harmless caution.
		expectIssue(parseProject(input), "invalid_metadata");
	});

	it("rejects a project that depends on two versions of one pack", () => {
		const input = baseProject();
		const [first] = input.metadata.packDependencies;
		input.metadata.packDependencies = [
			first,
			{ packId: first.packId, version: "2.0.0" },
		];
		expectIssue(parseProject(input), "invalid_pack_reference");
	});

	it("rejects the same dependency listed twice", () => {
		const input = baseProject();
		const [first] = input.metadata.packDependencies;
		input.metadata.packDependencies = [first, { ...first }];
		expectIssue(parseProject(input), "duplicate_id");
	});

	it("applies the one-version-per-pack rule to a standalone metadata document", () => {
		const input = baseProject();
		const [first] = input.metadata.packDependencies;
		input.metadata.packDependencies = [
			first,
			{ packId: first.packId, version: "2.0.0" },
		];
		expectIssue(parseProjectMetadata(input.metadata), "invalid_pack_reference");
	});

	it("accepts an empty dependency list on a project with no assets", () => {
		const input = baseProject();
		input.song.assets = [];
		input.song.tracks[0].instrument = { kind: "synth", parameters: {} };
		input.metadata.packDependencies = [];
		expect(parseProject(input).ok).toBe(true);
	});
});

describe("persistence tier parsers", () => {
	it("parses metadata, song, and clip documents separately", () => {
		const input = baseProject();
		expect(parseProjectMetadata(input.metadata).ok).toBe(true);
		expect(parseSong(input.song).ok).toBe(true);
		expect(parseClip(input.clips[0]).ok).toBe(true);
	});

	it("applies the same invariants to a standalone song document", () => {
		const input = baseProject();
		input.song.tracks[0].order = 4;
		expectIssue(parseSong(input.song), "invalid_order");
	});

	it("rejects a standalone song whose placement references a missing track", () => {
		const input = baseProject();
		input.song.placements[0].trackId = ids("track");
		expectIssue(parseSong(input.song), "dangling_reference");
	});

	it("applies clip-local invariants to a standalone clip document", () => {
		const outsideClip = baseProject();
		outsideClip.clips[0].content.events[0].startTicks =
			outsideClip.clips[0].lengthTicks + 10_000;
		expectIssue(parseClip(outsideClip.clips[0]), "invalid_musical_time");

		const duplicateEvent = baseProject();
		const events = duplicateEvent.clips[0].content.events;
		events[1].id = events[0].id;
		expectIssue(parseClip(duplicateEvent.clips[0]), "duplicate_id");
	});

	it("refuses a future schema version on the metadata document", () => {
		const input = baseProject();
		input.metadata.schemaVersion = SCHEMA_VERSION + 5;
		expectIssue(
			parseProjectMetadata(input.metadata),
			"unsupported_schema_version",
		);
	});
});

function device(
	order: number,
	type: string,
): JsonRecord & {
	id: string;
	order: number;
} {
	return {
		id: ids("device"),
		type,
		order,
		bypassed: false,
		parameters: {},
		preset: null,
	};
}

function lane(
	id: string,
	trackId: string,
	parameterId: string,
): MutableAutomation {
	return {
		id,
		target: { scope: "track", trackId, parameterId },
		interpolation: "linear",
		points: [{ tick: 0, value: 0 }],
	};
}
