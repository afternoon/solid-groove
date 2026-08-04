import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project, Track } from "../domain/entities";
import { createReferenceProject } from "../domain/fixtures";
import { buildAudioProjection } from "../projection/audioProjection";
import { installWebAudioGlobals } from "./testAudioContext";

installWebAudioGlobals();

let Tone: typeof import("tone");
let AudioRuntimeModule: typeof import("./AudioRuntime");
let ProjectAudioGraphModule: typeof import("./ProjectAudioGraph");
let TrackAudioGraphModule: typeof import("./TrackAudioGraph");

beforeAll(async () => {
	Tone = await import("tone");
	AudioRuntimeModule = await import("./AudioRuntime");
	ProjectAudioGraphModule = await import("./ProjectAudioGraph");
	TrackAudioGraphModule = await import("./TrackAudioGraph");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

function fakeTransport(): import("./ProjectAudioGraph").AudioTransport {
	let nextId = 1;
	return {
		bpm: { value: 120 },
		schedule() {
			return nextId++;
		},
		clear() {},
	};
}

function setFlags(
	project: Project,
	trackId: Track["id"],
	flags: Partial<Track["mixer"]>,
): Project {
	return {
		...project,
		song: {
			...project.song,
			tracks: project.song.tracks.map((track) =>
				track.id === trackId
					? { ...track, mixer: { ...track.mixer, ...flags } }
					: track,
			),
		},
	};
}

describe("track mixer audio graph (LOOP-007 / TRK-02)", () => {
	it("exposes a per-track level meter for every track", async () => {
		const project = createReferenceProject({
			trackCount: 3,
			placementCount: 3,
			automationLaneCount: 0,
		});
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		graph.reconcile(buildAudioProjection(project));

		for (const track of project.song.tracks) {
			expect(graph.trackMeter(track.id)).toBeDefined();
		}
		// A track that is not in the project has no meter.
		expect(graph.trackMeter("trk_absent" as never)).toBeUndefined();

		await graph.dispose();
		await runtime.close();
	});

	it("mute wins over solo: a muted, soloed track is silenced", async () => {
		const base = createReferenceProject({
			trackCount: 2,
			placementCount: 2,
			automationLaneCount: 0,
		});
		const soloed = base.song.tracks[0];
		const project = setFlags(base, soloed.id, { muted: true, soloed: true });

		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		graph.reconcile(buildAudioProjection(project));

		// Its own mute wins even though it is soloed.
		expect(graph.trackGraphs.get(soloed.id)?.isMuted).toBe(true);

		await graph.dispose();
		await runtime.close();
	});

	it("multiple soloed tracks play together; unsoloed tracks are silenced", async () => {
		const base = createReferenceProject({
			trackCount: 3,
			placementCount: 3,
			automationLaneCount: 0,
		});
		const [a, b, c] = base.song.tracks;
		let project = setFlags(base, a.id, { soloed: true });
		project = setFlags(project, b.id, { soloed: true });

		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		graph.reconcile(buildAudioProjection(project));

		// Two soloed tracks both play; the un-soloed one is silenced by the solo.
		expect(graph.trackGraphs.get(a.id)?.isMuted).toBe(false);
		expect(graph.trackGraphs.get(b.id)?.isMuted).toBe(false);
		expect(graph.trackGraphs.get(c.id)?.isMuted).toBe(true);

		await graph.dispose();
		await runtime.close();
	});

	it("a metadata-only edit (rename) creates no new audio resources", async () => {
		const project = createReferenceProject({
			trackCount: 4,
			placementCount: 4,
			automationLaneCount: 0,
		});
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});

		const before = buildAudioProjection(project);
		graph.reconcile(before);
		const resourcesBefore = runtime.diagnostics().resources.total;

		const renamed: Project = {
			...project,
			song: {
				...project.song,
				tracks: project.song.tracks.map((track) => ({
					...track,
					name: `${track.name} renamed`,
				})),
			},
		};
		graph.reconcile(buildAudioProjection(renamed, before));

		expect(runtime.diagnostics().resources.total).toBe(resourcesBefore);

		await graph.dispose();
		await runtime.close();
	});

	it("ramps volume and pan changes rather than stepping them (no zipper noise)", async () => {
		const base = createReferenceProject({
			trackCount: 1,
			placementCount: 1,
			automationLaneCount: 0,
		});
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});

		const before = buildAudioProjection(base);
		graph.reconcile(before);

		// Spy on the parameter ramp used by the channel strip. A control change
		// must schedule a short ramp, never a hard set, so it cannot click.
		// PanVol's volume is a Tone.Param and its pan a Tone.Signal, so both
		// prototypes are watched.
		const rampCalls: number[] = [];
		const paramSpy = vi
			.spyOn(Tone.Param.prototype, "rampTo")
			.mockImplementation(function (this: unknown, _value, time) {
				rampCalls.push(time as number);
				return this as never;
			});
		const signalSpy = vi
			.spyOn(Tone.Signal.prototype, "rampTo")
			.mockImplementation(function (this: unknown, _value, time) {
				rampCalls.push(time as number);
				return this as never;
			});

		const edited = setFlags(base, base.song.tracks[0].id, {});
		const withVolume: Project = {
			...edited,
			song: {
				...edited.song,
				tracks: edited.song.tracks.map((track, i) =>
					i === 0
						? { ...track, mixer: { ...track.mixer, volume: -18, pan: -0.5 } }
						: track,
				),
			},
		};
		graph.reconcile(buildAudioProjection(withVolume, before));

		// At least the volume and pan ramps (a send would add more).
		expect(rampCalls.length).toBeGreaterThanOrEqual(2);
		for (const time of rampCalls) {
			expect(time).toBe(TrackAudioGraphModule.MIXER_SMOOTHING_SECONDS);
			expect(time).toBeGreaterThan(0);
		}

		paramSpy.mockRestore();
		signalSpy.mockRestore();
		await graph.dispose();
		await runtime.close();
	});

	it("stays correct with more than 50 tracks", async () => {
		const project = createReferenceProject({
			trackCount: 55,
			placementCount: 55,
			automationLaneCount: 0,
		});
		expect(project.song.tracks.length).toBeGreaterThan(50);

		const runtime = new AudioRuntimeModule.AudioRuntime();
		const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
			transport: fakeTransport(),
		});
		graph.reconcile(buildAudioProjection(project));

		expect(graph.diagnostics().tracks).toBe(project.song.tracks.length);
		for (const track of project.song.tracks) {
			expect(graph.trackMeter(track.id)).toBeDefined();
		}

		await graph.dispose();
		await runtime.close();
	});
});
