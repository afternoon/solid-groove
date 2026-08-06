import { describe, expect, it } from "vitest";
import type { RawCommandInput } from "../commands";
import { changeInstrument, executeTransaction, removeNotes } from "../commands";
import type { Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import {
	createDrumMachineFixtureProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { createManualClock } from "../shared/clock";
import {
	countPadTriggeredHits,
	createInstrumentOfKind,
	DEFAULT_DRUM_PAD_NAMES,
	INSTRUMENT_KIND_CHOICES,
	instrumentTypeKey,
	padTriggeredHits,
} from "./instrumentKinds";

const context = () =>
	createFactoryContext({ ids: createSeededIdFactory(224), now: 0 });

describe("instrumentTypeKey", () => {
	it("maps every offered kind to its OPS-02 analytics key", () => {
		expect(INSTRUMENT_KIND_CHOICES.map((choice) => choice.kind)).toEqual([
			"sampler",
			"synth",
			"drumMachine",
		]);
		expect(instrumentTypeKey("sampler")).toBe("sampler");
		expect(instrumentTypeKey("synth")).toBe("synth");
		expect(instrumentTypeKey("drumMachine")).toBe("drum_machine");
	});
});

describe("createInstrumentOfKind", () => {
	it("builds an empty sampler and a default synth", () => {
		expect(createInstrumentOfKind("sampler", context())).toEqual({
			kind: "sampler",
			assetId: null,
			parameters: {},
		});
		expect(createInstrumentOfKind("synth", context())).toEqual({
			kind: "synth",
			parameters: {},
		});
	});

	it("builds a drum machine with named, sample-less, uniquely identified pads", () => {
		const instrument = createInstrumentOfKind("drumMachine", context());
		if (instrument.kind !== "drumMachine")
			throw new Error("expected a machine");
		expect(instrument.pads.map((pad) => pad.name)).toEqual([
			...DEFAULT_DRUM_PAD_NAMES,
		]);
		expect(instrument.pads.every((pad) => pad.assetId === null)).toBe(true);
		expect(new Set(instrument.pads.map((pad) => pad.id)).size).toBe(
			instrument.pads.length,
		);
	});
});

describe("padTriggeredHits", () => {
	it("finds the hits a drum-machine track would strand", () => {
		const project = createDrumMachineFixtureProject();
		const trackId = project.song.tracks[0].id;
		const hits = padTriggeredHits(project, trackId);

		expect(hits.length).toBeGreaterThan(0);
		expect(countPadTriggeredHits(hits)).toBeGreaterThan(0);
		for (const hit of hits) {
			const clip = project.clips.find(
				(candidate) => candidate.id === hit.clipId,
			);
			expect(clip?.trackId).toBe(trackId);
			expect(hit.eventIds.length).toBeGreaterThan(0);
		}
	});

	it("ignores pitched notes, other tracks, and no project at all", () => {
		const pitched = createSliceFixtureProject();
		expect(padTriggeredHits(pitched, pitched.song.tracks[0].id)).toEqual([]);

		const drums = createDrumMachineFixtureProject();
		const otherTrackId = drums.song.tracks[1]?.id;
		if (otherTrackId) {
			expect(padTriggeredHits(drums, otherTrackId)).toEqual([]);
		}

		expect(padTriggeredHits(null, drums.song.tracks[0].id)).toEqual([]);
	});
});

/**
 * The reason the picker clears the hits at all: through the real command
 * kernel, leaving a drum machine with its pad hits in place is rejected whole,
 * so a switch that only replaced the instrument would silently do nothing.
 */
describe("changing a track's instrument through the command kernel", () => {
	const execute = (project: Project, commands: RawCommandInput[]) =>
		executeTransaction(project, commands, {
			actor: "user",
			clock: createManualClock(),
		});

	it("accepts any switch that strands no pad hits", () => {
		const project = createSliceFixtureProject();
		const trackId = project.song.tracks[0].id;
		const result = execute(project, [
			changeInstrument(
				trackId,
				createInstrumentOfKind("drumMachine", context()),
			),
		]);
		expect(result.ok).toBe(true);
	});

	it("rejects leaving a drum machine until its hits go with it", () => {
		const project = createDrumMachineFixtureProject();
		const trackId = project.song.tracks[0].id;
		const synth = () => createInstrumentOfKind("synth", context());

		expect(execute(project, [changeInstrument(trackId, synth())]).ok).toBe(
			false,
		);

		const hits = padTriggeredHits(project, trackId);
		const cleared = execute(project, [
			...hits.map((hit) => removeNotes(hit.clipId, hit.eventIds)),
			changeInstrument(trackId, synth()),
		]);
		expect(cleared.ok).toBe(true);
	});
});
