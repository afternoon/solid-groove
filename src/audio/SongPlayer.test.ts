import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the data service so the store works without touching Firebase.
vi.mock("../model/dataService", () => ({
	dataService: {
		subscribeToProject: () => () => {},
		updateProject: vi.fn(async () => {}),
	},
}));

// Tone is only needed here for its Transport surface; stub it so the test
// exercises SongPlayer's reactive wiring rather than the Web Audio graph.
// Context lifecycle (create/install/resume/close) belongs to AudioRuntime,
// which SongPlayer now reaches only through the fake AudioHost below.
const transport = { bpm: { value: 0 }, start: vi.fn(), stop: vi.fn() };
vi.mock("tone", () => ({
	getTransport: () => transport,
	loaded: vi.fn(async () => {}),
	Sequence: class {
		start() {
			return this;
		}
		dispose() {}
	},
}));

/**
 * A minimal `AudioHost` double: no Tone, no Web Audio, just enough to prove
 * SongPlayer only ever asks the runtime for a destination/resume/scope
 * rather than reaching for Tone's globals itself.
 */
function createFakeRuntime(): AudioHost {
	let nextHandleId = 1;
	const scopes = new Map<string, Map<number, () => void | Promise<void>>>();

	return {
		getDestination: () => ({}) as Tone.ToneAudioNode,
		resume: vi.fn(async () => {}),
		openProjectScope(ownerId: string): AudioProjectScope {
			if (!scopes.has(ownerId)) scopes.set(ownerId, new Map());
			const resources = scopes.get(ownerId) as Map<
				number,
				() => void | Promise<void>
			>;
			return {
				ownerId,
				register: (_type, dispose) => {
					const id = nextHandleId++;
					resources.set(id, dispose);
					return { id };
				},
				release: async (handle) => {
					const dispose = resources.get(handle.id);
					resources.delete(handle.id);
					await dispose?.();
				},
				dispose: async () => {
					for (const dispose of resources.values()) await dispose();
					resources.clear();
				},
			};
		},
	};
}

/*
 * Fake instruments record the volume SongPlayer pushes into the audio graph.
 * setupToneInstruments applies every track on each run, so volumes are recorded
 * per track index rather than as one flat list.
 */
const setVolumeCalls: number[][] = [];
const instrumentDisposeMocks: ReturnType<typeof vi.fn>[] = [];
vi.mock("./ToneInstrument", () => ({
	createToneInstrument: () => {
		const index = setVolumeCalls.length;
		setVolumeCalls.push([]);
		const dispose = vi.fn();
		instrumentDisposeMocks.push(dispose);
		return {
			trigger: vi.fn(),
			updateParams: vi.fn(),
			getType: () => "sampler",
			setVolume: (v: number) => setVolumeCalls[index].push(v),
			dispose,
		};
	},
}));

/** Most recent volume applied to a given track's instrument. */
const latestVolume = (trackIndex: number): number | undefined =>
	setVolumeCalls[trackIndex]?.at(-1);

import type * as Tone from "tone";
import { newProject } from "../model/newProject";
import { projectStore, setProject, setTrack } from "../model/project";
import type { Project } from "../model/types";
import type { AudioHost, AudioProjectScope } from "./AudioRuntime";
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
		player = new SongPlayer(createFakeRuntime(), "test-owner");
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
		// SongPlayer now owns its subscription in its own root (so `dispose()`
		// can tear it down deterministically) rather than depending on the
		// caller's outer root, so both need to be released here.
		mounted.player.dispose();
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

describe("SongPlayer disposal", () => {
	beforeEach(() => {
		instrumentDisposeMocks.length = 0;
	});

	it("disposes every instrument exactly once, and a second dispose() is a no-op", async () => {
		setVolumeCalls.length = 0;
		setProject({ ...newProject("user-1"), id: "p1", createdAt });
		const mounted = mountPlayer();
		await mounted.player.play();

		expect(instrumentDisposeMocks.length).toBeGreaterThan(0);

		mounted.player.dispose();
		for (const dispose of instrumentDisposeMocks) {
			expect(dispose).toHaveBeenCalledTimes(1);
		}

		// Idempotent: calling dispose() again does not re-dispose anything.
		mounted.player.dispose();
		for (const dispose of instrumentDisposeMocks) {
			expect(dispose).toHaveBeenCalledTimes(1);
		}

		mounted.dispose();
	});

	it("dispose() before play() ever ran is safe — nothing was created yet", () => {
		setProject({ ...newProject("user-1"), id: "p1", createdAt });
		let player!: SongPlayer;
		const dispose = createRoot((disposeRoot) => {
			player = new SongPlayer(createFakeRuntime(), "test-owner-partial");
			player.setProjectStore(projectStore);
			return disposeRoot;
		});

		expect(() => player.dispose()).not.toThrow();
		expect(() => player.dispose()).not.toThrow();

		dispose();
	});
});
