import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the data service so the store works without touching Firebase.
vi.mock("../model/dataService", () => ({
	dataService: {
		subscribeToProject: () => () => {},
		updateProject: vi.fn(async () => {}),
	},
}));

// Tone is only needed here for its Transport/Destination surface; stub it so the
// test exercises SongPlayer's reactive wiring rather than the Web Audio graph.
const transport = { bpm: { value: 0 }, start: vi.fn(), stop: vi.fn() };
vi.mock("tone", () => ({
	getTransport: () => transport,
	getDestination: () => ({}),
	getContext: () => ({ state: "running" }),
	start: vi.fn(async () => {}),
	loaded: vi.fn(async () => {}),
	Sequence: class {
		start() {
			return this;
		}
		dispose() {}
	},
}));

/*
 * Fake instruments record the volume SongPlayer pushes into the audio graph.
 * setupToneInstruments applies every track on each run, so volumes are recorded
 * per track index rather than as one flat list.
 */
const setVolumeCalls: number[][] = [];
vi.mock("./ToneInstrument", () => ({
	createToneInstrument: () => {
		const index = setVolumeCalls.length;
		setVolumeCalls.push([]);
		return {
			trigger: vi.fn(),
			updateParams: vi.fn(),
			getType: () => "sampler",
			setVolume: (v: number) => setVolumeCalls[index].push(v),
			dispose: vi.fn(),
		};
	},
}));

/** Most recent volume applied to a given track's instrument. */
const latestVolume = (trackIndex: number): number | undefined =>
	setVolumeCalls[trackIndex]?.at(-1);

import { newProject } from "../model/newProject";
import { projectStore, setProject, setTrack } from "../model/project";
import type { Project } from "../model/types";
import SongPlayer from "./SongPlayer";

/** A stand-in for Firestore's server-generated createdAt. */
const createdAt = {
	toDate: () => new Date("2025-01-01T00:00:00Z"),
	seconds: 0,
	nanoseconds: 0,
} as Project["createdAt"];

/**
 * Wire a SongPlayer to the real project store inside a reactive root, with
 * playback already started so instruments exist.
 */
function mountPlayer(): { player: SongPlayer; dispose: () => void } {
	let player!: SongPlayer;
	const dispose = createRoot((disposeRoot) => {
		player = new SongPlayer();
		player.setProjectStore(projectStore);
		return disposeRoot;
	});
	return { player, dispose };
}

describe("SongPlayer track volume reactivity", () => {
	let mounted: { player: SongPlayer; dispose: () => void };

	beforeEach(async () => {
		setVolumeCalls.length = 0;
		setProject({ ...newProject("user-1"), id: "p1", createdAt });
		mounted = mountPlayer();
		// play() flips hasStarted, which is what creates the instruments.
		await mounted.player.play();
		for (const calls of setVolumeCalls) calls.length = 0;
	});

	afterEach(() => {
		mounted.dispose();
	});

	it("pushes a track volume change into the audio graph", async () => {
		// The regression: the store updated and the UI moved, but the effect never
		// re-ran, so the gain node was never touched and the fader did nothing.
		setTrack(0, { volume: 0.25 });
		await Promise.resolve();

		expect(setVolumeCalls[0].length).toBeGreaterThan(0);
		// 0.25 fader position through the square-law taper => 0.0625 gain.
		expect(latestVolume(0)).toBeCloseTo(0.0625);
	});

	it("applies the perceptual taper rather than the raw fader position", async () => {
		setTrack(0, { volume: 0.5 });
		await Promise.resolve();

		expect(latestVolume(0)).toBeCloseTo(0.25);
	});

	it("silences a muted track regardless of its fader position", async () => {
		setTrack(0, { volume: 1.0, isMuted: true });
		await Promise.resolve();

		expect(latestVolume(0)).toBe(0);
	});

	it("silences non-soloed tracks when another track is soloed", async () => {
		setTrack(1, { isSolo: true });
		await Promise.resolve();

		// Track 0 is not soloed, so it must be silenced; track 1 stays audible.
		expect(latestVolume(0)).toBe(0);
		expect(latestVolume(1)).toBeCloseTo(1);
	});
});
