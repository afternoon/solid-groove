import { cleanup, renderHook } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { AudioHost, AudioProjectScope } from "../audio/AudioRuntime";
import { installWebAudioGlobals } from "../audio/testAudioContext";
import { createSliceFixtureProject } from "../domain/fixtures";
import { memoryStorage } from "../testing/storage";

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("../audio/AudioRuntime");
let useProjectAudioModule: typeof import("./useProjectAudio");

beforeAll(async () => {
	AudioRuntimeModule = await import("../audio/AudioRuntime");
	useProjectAudioModule = await import("./useProjectAudio");
});

afterEach(async () => {
	cleanup();
	useProjectAudioModule.__resetFirstPlayInSessionForTests();
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

function fakeAnalytics() {
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	return { analytics, transport };
}

/**
 * A minimal `AudioHost` whose `getDestination`/`openProjectScope` are never
 * meant to be called — `play()`'s error path only reaches `resume()` before
 * `useProjectAudio`'s reconcile effect (the only caller of the other two)
 * would run, as long as the `project` accessor stays `null`.
 */
function unreachableAudioHost(resume: () => Promise<void>): AudioHost {
	return {
		getDestination: () => {
			throw new Error("not reachable in this test");
		},
		getSampleRate: () => {
			throw new Error("not reachable in this test");
		},
		resume,
		openProjectScope: (): AudioProjectScope => {
			throw new Error("not reachable in this test");
		},
	};
}

describe("useProjectAudio", () => {
	it("logs audio_start_failed and never throws when resume() is rejected", async () => {
		const { analytics, transport } = fakeAnalytics();
		const runtime = unreachableAudioHost(() =>
			Promise.reject(new Error("NotAllowedError: blocked")),
		);

		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		await expect(result.play()).resolves.toBeUndefined();

		expect(result.isPlaying()).toBe(false);
		const events = transport.named("audio_start_failed");
		expect(events).toHaveLength(1);
		expect(events[0]?.params.error_code).toBeDefined();
	});

	it("toggle() plays then stops without a runtime that ever rejects", async () => {
		const { analytics } = fakeAnalytics();
		let resumed = 0;
		const runtime = unreachableAudioHost(() => {
			resumed += 1;
			return Promise.resolve();
		});

		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		await result.toggle();
		expect(result.isPlaying()).toBe(true);
		expect(resumed).toBe(1);

		await result.toggle();
		expect(result.isPlaying()).toBe(false);
		// stop() never calls resume() again.
		expect(resumed).toBe(1);
	});

	it("emits transport_play exactly once per play, with is_first_play_in_session true only the first time", async () => {
		const { analytics, transport } = fakeAnalytics();
		const runtime = unreachableAudioHost(() => Promise.resolve());

		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		await result.play();
		result.stop();
		await result.play();

		const events = transport.named("transport_play");
		expect(events).toHaveLength(2);
		expect(events[0]?.params.is_first_play_in_session).toBe(true);
		expect(events[1]?.params.is_first_play_in_session).toBe(false);
		// The surface is attached automatically (PRD OPS-02), not passed per event.
		expect(events[0]?.params.surface).toBeDefined();
	});

	it("does not emit transport_play when the context cannot unlock", async () => {
		const { analytics, transport } = fakeAnalytics();
		const runtime = unreachableAudioHost(() =>
			Promise.reject(new Error("NotAllowedError: blocked")),
		);

		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		await result.play();

		// A blocked unlock is reported as audio_start_failed, never transport_play.
		expect(transport.named("transport_play")).toHaveLength(0);
		expect(transport.named("audio_start_failed")).toHaveLength(1);
		expect(
			transport.named("audio_start_failed")[0]?.params.was_browser_blocked,
		).toBeDefined();
	});

	it("treats a never-settling resume() as a browser-blocked unlock (issue #43)", async () => {
		const { analytics, transport } = fakeAnalytics();
		// Firefox under a blocked autoplay policy resolves neither way — the
		// resume promise never settles. Model that exactly.
		const runtime = unreachableAudioHost(() => new Promise<void>(() => {}));

		// A synchronous timer fires the timeout immediately, so the never-settling
		// resume loses the race deterministically without waiting on wall clock.
		let fired = 0;
		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
					resumeTimeoutMs: 5_000,
					setTimer: (callback) => {
						fired += 1;
						callback();
						return 0;
					},
					clearTimer: () => {},
				}),
			{},
		);

		await expect(result.play()).resolves.toBeUndefined();

		expect(fired).toBe(1);
		// The play button does not silently hang: exactly one browser-blocked
		// failure is surfaced, and playback never claims to have started.
		expect(result.isPlaying()).toBe(false);
		const failures = transport.named("audio_start_failed");
		expect(failures).toHaveLength(1);
		expect(failures[0]?.params.was_browser_blocked).toBe(true);
		expect(failures[0]?.params.error_code).toBe("autoplay_blocked");
		// A blocked unlock is never reported as a play.
		expect(transport.named("transport_play")).toHaveLength(0);
	});

	it("continueFromStop goes through the same bounded unlock and reports one play", async () => {
		const { analytics, transport } = fakeAnalytics();
		let resumed = 0;
		const runtime = unreachableAudioHost(() => {
			resumed += 1;
			return Promise.resolve();
		});

		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		await result.play();
		result.stop();
		// Shift+Space is a start-playback gesture too, so it unlocks the context
		// and reports exactly like Space does — one resume, one transport_play.
		await result.continueFromStop();

		expect(resumed).toBe(2);
		expect(result.isPlaying()).toBe(true);
		expect(transport.named("transport_play")).toHaveLength(2);
	});

	it("builds a real audio graph for the loaded project and disposes it without leaking resources when the owner unmounts", async () => {
		const runtime = AudioRuntimeModule.getAudioRuntime();
		const project = createSliceFixtureProject();

		const { result, cleanup: cleanupHook } = renderHook(
			() => useProjectAudioModule.useProjectAudio(() => project),
			{},
		);
		// Force the reconcile effect to run before asserting.
		void result.isPlaying();
		await Promise.resolve();
		await Promise.resolve();

		const afterMount = runtime.diagnostics().resources;
		expect(afterMount.byType.node ?? 0).toBeGreaterThan(0);
		expect(afterMount.byOwner[project.metadata.id]).toBeGreaterThan(0);

		cleanupHook();
		await Promise.resolve();
		await Promise.resolve();

		const afterDispose = runtime.diagnostics().resources;
		// The graph's own resources (nodes, schedules, subscriptions, buffers)
		// are all released; only the shared context — which this project graph
		// never owned and disposal must never touch (PRD AUD-07) — remains.
		expect(afterDispose.byOwner[project.metadata.id]).toBeUndefined();
		expect(afterDispose.byType.node ?? 0).toBe(0);
		expect(afterDispose.byType.schedule ?? 0).toBe(0);
		expect(afterDispose.byType.subscription ?? 0).toBe(0);
	});

	it("auditionTrack unlocks the context and resolves true on a loaded project", async () => {
		const { analytics } = fakeAnalytics();
		let resumed = 0;
		const runtime = unreachableAudioHost(() => {
			resumed += 1;
			return Promise.resolve();
		});
		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		const played = await result.auditionTrack(
			"trk_any" as never,
			{ kind: "pitch", pitch: 60 },
			192,
			0.9,
		);
		// The audition is a user gesture: it resumes the shared context exactly once
		// and reports success even when the graph has no such track (a no-op play).
		expect(played).toBe(true);
		expect(resumed).toBe(1);
	});

	it("auditionTrack reports audio_start_failed and resolves false when blocked", async () => {
		const { analytics, transport } = fakeAnalytics();
		const runtime = unreachableAudioHost(() =>
			Promise.reject(new Error("NotAllowedError: blocked")),
		);
		const { result } = renderHook(
			() =>
				useProjectAudioModule.useProjectAudio(() => null, {
					runtime,
					analytics,
				}),
			{},
		);

		const played = await result.auditionTrack(
			"trk_any" as never,
			{ kind: "pitch", pitch: 60 },
			192,
			0.9,
		);
		expect(played).toBe(false);
		expect(transport.named("audio_start_failed")).toHaveLength(1);
	});
});
