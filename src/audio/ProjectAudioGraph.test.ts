import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project } from "../domain/entities";
import { createFactoryContext, createReturnBus } from "../domain/factories";
import {
	createReferenceProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_SIXTEENTH, ticksToSeconds } from "../domain/time";
import { buildAudioProjection } from "../projection/audioProjection";
import { installWebAudioGlobals } from "./testAudioContext";

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("./AudioRuntime");
let ProjectAudioGraphModule: typeof import("./ProjectAudioGraph");

beforeAll(async () => {
	AudioRuntimeModule = await import("./AudioRuntime");
	ProjectAudioGraphModule = await import("./ProjectAudioGraph");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

/** A deterministic transport double: records every schedule/clear call by id
 * instead of touching a real Tone.Transport, so scheduling can be asserted
 * without any timing dependence. */
function fakeTransport(): import("./ProjectAudioGraph").AudioTransport & {
	scheduled: Map<number, string>;
	cleared: number[];
	callbacks: Map<number, (time: number) => void>;
} {
	let nextId = 1;
	const scheduled = new Map<number, string>();
	const cleared: number[] = [];
	// Kept so a test can fire a scheduled event and assert what actually
	// reaches Tone, rather than only that something was scheduled.
	const callbacks = new Map<number, (time: number) => void>();
	return {
		bpm: { value: 120 },
		scheduled,
		cleared,
		callbacks,
		schedule(callback, time) {
			const id = nextId++;
			scheduled.set(id, time);
			callbacks.set(id, callback);
			return id;
		},
		clear(id) {
			cleared.push(id);
			scheduled.delete(id);
			callbacks.delete(id);
		},
	};
}

/** A loader that resolves manually, so cache races (asset replaced mid-decode)
 * are fully controllable from the test. */
function manualBufferLoader(): {
	loader: import("./AudioBufferCache").AssetBufferLoader<
		import("tone").ToneAudioBuffer
	>;
	pending: {
		fingerprint: string;
		resolve: (buffer: import("tone").ToneAudioBuffer) => void;
	}[];
} {
	const pending: {
		fingerprint: string;
		resolve: (buffer: import("tone").ToneAudioBuffer) => void;
	}[] = [];
	return {
		pending,
		loader: {
			load(asset) {
				return new Promise((resolve) => {
					pending.push({ fingerprint: asset.fingerprint, resolve });
				});
			},
		},
	};
}

function fakeBuffer(): import("tone").ToneAudioBuffer {
	return { dispose: () => {} } as unknown as import("tone").ToneAudioBuffer;
}

describe("ProjectAudioGraph", () => {
	it("reconciling the same projection object twice is a full no-op", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		const project = createSliceFixtureProject();
		const projection = buildAudioProjection(project);

		graph.reconcile(projection);
		const afterFirst = { ...graph.diagnostics() };

		graph.reconcile(projection);
		expect(graph.diagnostics()).toEqual(afterFirst);

		await graph.dispose();
		await runtime.close();
	});

	it("editing one track's mixer does not touch other tracks' graphs", async () => {
		const project = createReferenceProject({
			trackCount: 4,
			placementCount: 8,
		});
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		const [changedTrack, ...untouched] = project.song.tracks;
		const untouchedGraphsBefore = untouched.map((t) =>
			graph.trackGraphs.get(t.id),
		);

		const edited: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.map((track) =>
					track.id === changedTrack.id
						? { ...track, mixer: { ...track.mixer, volume: -20 } }
						: track,
				),
			},
		};
		const after = buildAudioProjection(edited, before);
		graph.reconcile(after);

		untouched.forEach((track, index) => {
			expect(graph.trackGraphs.get(track.id)).toBe(
				untouchedGraphsBefore[index],
			);
		});

		await graph.dispose();
		await runtime.close();
	});

	it("renaming a track is a complete no-op for its audio graph", async () => {
		const project = createSliceFixtureProject();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		const trackId = project.song.tracks[0].id;
		const graphBefore = graph.trackGraphs.get(trackId);

		const renamed: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.map((track) => ({
					...track,
					name: "Renamed",
				})),
			},
		};
		const after = buildAudioProjection(renamed, before);
		graph.reconcile(after);

		expect(graph.trackGraphs.get(trackId)).toBe(graphBefore);

		await graph.dispose();
		await runtime.close();
	});

	it("schedules one transport event per note event, at the placement-relative absolute tick", async () => {
		const project = createSliceFixtureProject();
		const transport = fakeTransport();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport,
		});

		graph.reconcile(buildAudioProjection(project));

		const times = [...transport.scheduled.values()].sort();
		expect(times).toEqual(
			[0, 4, 8, 12]
				.map((sixteenth) => sixteenth * TICKS_PER_SIXTEENTH)
				.map((ticks) => `${ticks}i`)
				.sort(),
		);
		expect(graph.diagnostics().scheduledPlacements).toBe(1);

		await graph.dispose();
		await runtime.close();
	});

	it("clears every scheduled event for a placement that is removed", async () => {
		const project = createSliceFixtureProject();
		const transport = fakeTransport();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport,
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		expect(transport.scheduled.size).toBe(4);

		const emptied: Project = {
			...project,
			song: { ...project.song, placements: [] },
		};
		graph.reconcile(buildAudioProjection(emptied, before));

		expect(transport.scheduled.size).toBe(0);
		expect(transport.cleared).toHaveLength(4);
		expect(graph.diagnostics().scheduledPlacements).toBe(0);

		await graph.dispose();
		await runtime.close();
	});

	it("swapping a track's instrument asset releases the old buffer subscription and attaches the new one", async () => {
		const project = createSliceFixtureProject();
		const { loader, pending } = manualBufferLoader();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
			bufferLoader: loader,
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		pending[0].resolve(fakeBuffer());
		await Promise.resolve();
		await Promise.resolve();
		expect(graph.diagnostics().buffers.cachedAssets).toBe(1);
		const subscriptionsBefore =
			runtime.diagnostics().resources.byType.subscription;

		const newAsset = {
			...project.song.assets[0],
			id: createSeededIdFactory("swap-asset")("asset"),
		};
		const track = project.song.tracks[0];
		if (track.instrument?.kind !== "sampler") {
			throw new Error("expected the slice fixture's track to be a sampler");
		}
		const instrument = track.instrument;
		const edited: Project = {
			...project,
			song: {
				...project.song,
				assets: [...project.song.assets, newAsset],
				tracks: project.song.tracks.map((t) =>
					t.id === track.id
						? { ...t, instrument: { ...instrument, assetId: newAsset.id } }
						: t,
				),
			},
		};
		graph.reconcile(buildAudioProjection(edited, before));
		pending[1].resolve(fakeBuffer());
		await Promise.resolve();
		await Promise.resolve();

		// Old asset's subscription released, new asset's created: the count of
		// live subscriptions this track holds does not grow.
		expect(runtime.diagnostics().resources.byType.subscription).toBe(
			subscriptionsBefore,
		);

		await graph.dispose();
		await runtime.close();
	});

	it("replacing an asset's content twice in a row never lets the stale decode win, and never recreates the instrument", async () => {
		const project = createSliceFixtureProject();
		const { loader, pending } = manualBufferLoader();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
			bufferLoader: loader,
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		const trackGraphBefore = graph.trackGraphs.get(project.song.tracks[0].id);
		// The initial decode is left unresolved on purpose — a track/instrument
		// reconcile must never depend on a buffer already being loaded.

		const withUrl = (project: Project, url: string): Project => ({
			...project,
			song: {
				...project.song,
				assets: project.song.assets.map((asset) => ({ ...asset, url })),
			},
		});

		let latest = before;
		latest = buildAudioProjection(withUrl(project, "/samples/v2.wav"), latest);
		graph.reconcile(latest);
		latest = buildAudioProjection(withUrl(project, "/samples/v3.wav"), latest);
		graph.reconcile(latest);

		// Only the asset's content changed, not which asset id the track
		// references, so the track's instrument identity is untouched
		// throughout every one of these edits.
		expect(graph.trackGraphs.get(project.song.tracks[0].id)).toBe(
			trackGraphBefore,
		);
		expect(pending).toHaveLength(3);

		// Resolve out of order: the newest decode first, then the two stale
		// ones. Neither stale completion may overwrite the newest result.
		pending[2].resolve(fakeBuffer());
		await Promise.resolve();
		await Promise.resolve();
		pending[1].resolve(fakeBuffer());
		pending[0].resolve(fakeBuffer());
		await Promise.resolve();
		await Promise.resolve();

		expect(graph.diagnostics().buffers.cachedAssets).toBe(1);
		expect(graph.diagnostics().buffers.pendingLoads).toBe(0);

		await graph.dispose();
		await runtime.close();
	});

	it("removing a return bus disposes it only after the track sends targeting it are gone", async () => {
		const context = createFactoryContext();
		const bus = createReturnBus(context, { name: "Reverb", order: 0 });
		const project = createSliceFixtureProject();
		const withReturn: Project = {
			...project,
			song: {
				...project.song,
				returns: [bus],
				tracks: project.song.tracks.map((track) => ({
					...track,
					sendConfig: [{ returnId: bus.id, level: 0.5, preFader: false }],
				})),
			},
		};

		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		const before = buildAudioProjection(withReturn);
		graph.reconcile(before);
		expect(graph.returnGraphs.size).toBe(1);

		const removed: Project = {
			...withReturn,
			song: {
				...withReturn.song,
				returns: [],
				tracks: withReturn.song.tracks.map((track) => ({
					...track,
					sendConfig: [],
				})),
			},
		};
		expect(() =>
			graph.reconcile(buildAudioProjection(removed, before)),
		).not.toThrow();
		expect(graph.returnGraphs.size).toBe(0);

		await graph.dispose();
		await runtime.close();
	});

	it("adding and removing a track creates/disposes only that track's graph", async () => {
		const project = createReferenceProject({
			trackCount: 2,
			placementCount: 4,
		});
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		expect(graph.trackGraphs.size).toBe(2);
		const survivingId = project.song.tracks[0].id;
		const survivorBefore = graph.trackGraphs.get(survivingId);

		const removedOne: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.slice(0, 1),
				placements: project.song.placements.filter(
					(p) => p.trackId === survivingId,
				),
			},
		};
		graph.reconcile(buildAudioProjection(removedOne, before));
		expect(graph.trackGraphs.size).toBe(1);
		expect(graph.trackGraphs.get(survivingId)).toBe(survivorBefore);

		await graph.dispose();
		await runtime.close();
	});

	it("dispose() releases every resource this graph registered and is idempotent", async () => {
		const project = createSliceFixtureProject();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});

		graph.reconcile(buildAudioProjection(project));
		expect(runtime.diagnostics().resources.byOwner.p).toBeGreaterThan(0);

		await graph.dispose();
		await expect(graph.dispose()).resolves.toBeUndefined(); // idempotent

		expect(runtime.diagnostics().resources.byOwner.p).toBeUndefined();

		await runtime.close();
	});

	it("dispose() never touches the shared runtime or another project's scope", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const other = new ProjectAudioGraphModule.ProjectAudioGraph(
			runtime,
			"other",
			{
				transport: fakeTransport(),
			},
		);
		other.reconcile(buildAudioProjection(createSliceFixtureProject()));

		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		graph.reconcile(buildAudioProjection(createSliceFixtureProject()));

		await graph.dispose();

		expect(runtime.diagnostics().resources.byOwner.other).toBeGreaterThan(0);
		expect(runtime.getState()).not.toBe("closed");

		await other.dispose();
		await runtime.close();
	});

	// Every fixture in this repo authors its audio at `sourceTempo === tempo`,
	// where buffer seconds and song seconds coincide and a units bug in either
	// `player.start()` argument is invisible. This is the one test that pulls
	// them apart, so it is the only thing standing between a rate != 1 project
	// and silently truncated or overrunning loops (also inherited by the
	// AUD-05/AUD-06 offline and stem exports, which reuse this expansion).
	it("hands Tone buffer-timeline seconds for a loop whose sample tempo differs from the song", async () => {
		const Tone = await import("tone");
		const base = createReferenceProject({
			trackCount: 1,
			waveformTrackCount: 1,
			placementCount: 1,
			minutes: 1,
			automationLaneCount: 0,
		});
		// Authored at 60 BPM, played back in a 120 BPM song => playbackRate 2.
		const project: Project = {
			...base,
			clips: base.clips.map((clip) =>
				clip.content.kind === "audioLoop"
					? { ...clip, content: { ...clip.content, sourceTempo: 60 } }
					: clip,
			),
		};

		const { loader, pending } = manualBufferLoader();
		const transport = fakeTransport();
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport,
			bufferLoader: loader,
		});

		const projection = buildAudioProjection(project);
		graph.reconcile(projection);
		for (const p of pending) p.resolve(fakeBuffer());
		await Promise.resolve();
		await Promise.resolve();

		const start = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});

		try {
			for (const callback of transport.callbacks.values()) callback(0);

			expect(start).toHaveBeenCalled();
			const [, offsetArg, durationArg] = start.mock.calls[0];
			// Both must be plain buffer-seconds numbers. A tick string like
			// "768i" here is the regression: Tone divides the duration by the
			// playback rate, so song-timeline ticks sound for half as long at
			// rate 2.
			expect(typeof offsetArg).toBe("number");
			expect(typeof durationArg).toBe("number");

			// The scheduled event covers min(clip length, placement duration)
			// of song time; at rate 2 that has to reach Tone doubled, so that
			// Tone's divide-by-rate leaves the correct sounded length.
			const clip = project.clips.find((c) => c.content.kind === "audioLoop");
			const placement = project.song.placements.find(
				(p) => p.clipId === clip?.id,
			);
			if (!clip || !placement) throw new Error("fixture has no audio loop");
			const eventTicks = Math.min(clip.lengthTicks, placement.durationTicks);
			expect(durationArg).toBeCloseTo(ticksToSeconds(eventTicks, 120) * 2);
		} finally {
			start.mockRestore();
		}

		await graph.dispose();
		await runtime.close();
	});
});
