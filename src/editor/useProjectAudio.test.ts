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
});
