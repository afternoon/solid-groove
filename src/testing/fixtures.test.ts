import { beforeEach, describe, expect, it } from "vitest";
import {
	buildInstrument,
	buildProject,
	buildSong,
	buildTrack,
	loadFixtureJson,
	loadSampleProjectFixture,
	resetFixtureBuilderCounter,
} from "./fixtures";

describe("loadFixtureJson", () => {
	it("reads and parses a fixture from public/fixtures/ via the Node path", async () => {
		const fixture = await loadFixtureJson<{ name: string }>(
			"sample-project.json",
		);
		expect(fixture.name).toBe("Fixture Groove");
	});

	it("rejects a fixture that does not exist", async () => {
		await expect(loadFixtureJson("does-not-exist.json")).rejects.toThrow();
	});
});

describe("loadSampleProjectFixture", () => {
	it("converts the ISO createdAt string into a Timestamp-shaped object", async () => {
		const project = await loadSampleProjectFixture();
		expect(project.name).toBe("Fixture Groove");
		expect(project.createdAt.toDate()).toEqual(
			new Date("2025-01-01T00:00:00.000Z"),
		);
		expect(project.latestSnapshot.song.tracks).toHaveLength(2);
	});
});

describe("fixture builders", () => {
	beforeEach(() => {
		resetFixtureBuilderCounter();
	});

	it("buildInstrument returns a valid sampler by default and merges overrides", () => {
		const instrument = buildInstrument({ sampleUrl: "/samples/custom.wav" });
		expect(instrument.type).toBe("sampler");
		expect(instrument.sampleUrl).toBe("/samples/custom.wav");
		expect(instrument.envelope).toBeDefined();
	});

	it("buildTrack fills in defaults and assigns stable incrementing names", () => {
		const first = buildTrack();
		const second = buildTrack({ isMuted: true });
		expect(first.name).toBe("Track 1");
		expect(second.name).toBe("Track 2");
		expect(second.isMuted).toBe(true);
		expect(second.instrument.type).toBe("sampler");
	});

	it("buildSong defaults to one track and one empty 16-step pattern", () => {
		const song = buildSong();
		expect(song.tracks).toHaveLength(1);
		expect(song.patterns).toHaveLength(1);
		expect(song.patterns[0].sequences[0].steps).toHaveLength(16);
		expect(song.patterns[0].sequences[0].steps.every((s) => s === null)).toBe(
			true,
		);
	});

	it("buildProject produces a fully valid, independent project each call", () => {
		const a = buildProject();
		const b = buildProject();
		expect(a.id).not.toBe(b.id);
		// Independent: mutating one does not affect the other.
		a.latestSnapshot.song.tracks[0].name = "mutated";
		expect(b.latestSnapshot.song.tracks[0].name).not.toBe("mutated");
	});

	it("buildProject accepts overrides", () => {
		const project = buildProject({ name: "My Song", isPublic: true });
		expect(project.name).toBe("My Song");
		expect(project.isPublic).toBe(true);
	});
});
