import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";

// Must run before Tone is imported so Tone builds on a real (offline-capable)
// Web Audio implementation instead of jsdom's absent one.
installWebAudioGlobals();

// Imported lazily, after the globals are installed, to keep import order
// correct — see ToneInstrument.test.ts for the same pattern.
//
// These tests exercise `ensureContext()`/`close()` against a *real* Tone
// context (construction and closing are reliable in this environment), but
// deliberately never call `resume()`/`Tone.start()` on a live context — in
// this sandbox that hangs waiting on an audio callback that never fires,
// which is exactly why the rest of the codebase's Tone tests
// (ToneInstrument.test.ts) render exclusively through `Tone.Offline()`
// rather than a live context. `resume()`'s own call sequence is covered
// separately in AudioRuntime.resume.test.ts against a mocked Tone module.
let AudioRuntimeModule: typeof import("./AudioRuntime");

beforeAll(async () => {
	AudioRuntimeModule = await import("./AudioRuntime");
});

afterEach(async () => {
	// Best-effort cleanup for tests that used the global singleton, so a real
	// AudioContext never leaks into the next test.
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// Already closed/replaced by the test itself — fine.
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

describe("AudioRuntime context ownership", () => {
	it("creates the context lazily and reuses the same instance", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();

		const first = runtime.ensureContext();
		const second = runtime.ensureContext();

		expect(second).toBe(first);
		// Whether this is the very first context Tone's own module-import
		// side effect already created (adopted — see "AudioRuntime single
		// real-time context" for a test that pins this down deterministically)
		// or one this runtime had to construct itself (created) depends on
		// what ran before it in this file, but either way `ensureContext()`
		// must account for exactly one real context, never a second one on
		// top of an existing live one (AUD-07/AUD-09).
		const { contextsCreated, contextsAdopted } = runtime.diagnostics();
		expect(contextsCreated + contextsAdopted).toBe(1);

		return runtime.close();
	});

	it("getDestination() ensures a context exists rather than creating a second one", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();
		const before = runtime.diagnostics().contextsCreated;

		runtime.getDestination();

		expect(runtime.diagnostics().contextsCreated).toBe(before);
		return runtime.close();
	});

	it("close() releases the context so a later ensureContext creates a new one", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const first = runtime.ensureContext();

		await runtime.close();
		expect(runtime.getState()).toBe("closed");
		expect(runtime.diagnostics().contextsClosed).toBe(1);

		const second = runtime.ensureContext();
		expect(second).not.toBe(first);
		expect(runtime.diagnostics().contextsCreated).toBe(2);

		await runtime.close();
	});

	it("closing again after a reopen closes the new context, not a stale settled promise", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();
		await runtime.close();

		runtime.ensureContext();
		await runtime.close();

		expect(runtime.getState()).toBe("closed");
		expect(runtime.diagnostics().contextsCreated).toBe(2);
		expect(runtime.diagnostics().contextsClosed).toBe(2);
	});
});

describe("AudioRuntime disposal", () => {
	it("close() is idempotent — repeated and concurrent calls settle once", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();

		const [a, b] = await Promise.all([runtime.close(), runtime.close()]);
		await runtime.close();

		expect(a).toBeUndefined();
		expect(b).toBeUndefined();
		expect(runtime.diagnostics().contextsClosed).toBe(1);
	});

	it("closing a runtime that never created a context is safe (partial initialization)", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();

		await expect(runtime.close()).resolves.toBeUndefined();

		expect(runtime.getState()).toBe("closed");
		expect(runtime.diagnostics().contextsCreated).toBe(0);
		expect(runtime.diagnostics().contextsClosed).toBe(0);
	});

	it("close() disposes every project scope it still owns, even one with a failing disposer", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();

		const okDispose = vi.fn();
		const scopeA = runtime.openProjectScope("project-a");
		scopeA.register("node", okDispose);

		const scopeB = runtime.openProjectScope("project-b");
		scopeB.register("node", () => {
			throw new Error("boom");
		});

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		await runtime.close();
		consoleError.mockRestore();

		expect(okDispose).toHaveBeenCalledTimes(1);
		expect(runtime.diagnostics().resources.total).toBe(0);
	});

	it("releasing a pending-load handle twice (cancellation racing completion) aborts only once", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const abort = vi.fn();
		const scope = runtime.openProjectScope("project-a");
		const handle = scope.register("pendingLoad", abort);

		await Promise.all([scope.release(handle), scope.release(handle)]);

		expect(abort).toHaveBeenCalledTimes(1);
		await runtime.close();
	});
});

describe("AudioRuntime project scopes", () => {
	it("disposing one project's scope never touches another project's resources or the context", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();
		const contextsCreated = runtime.diagnostics().contextsCreated;

		const disposeA = vi.fn();
		const disposeB = vi.fn();
		const scopeA = runtime.openProjectScope("project-a");
		scopeA.register("graph", disposeA);
		const scopeB = runtime.openProjectScope("project-b");
		scopeB.register("graph", disposeB);

		await scopeA.dispose();

		expect(disposeA).toHaveBeenCalledTimes(1);
		expect(disposeB).not.toHaveBeenCalled();
		expect(runtime.diagnostics().resources.byOwner["project-b"]).toBe(1);
		expect(
			runtime.diagnostics().resources.byOwner["project-a"],
		).toBeUndefined();
		expect(runtime.getState()).not.toBe("closed");
		expect(runtime.diagnostics().contextsCreated).toBe(contextsCreated);

		await runtime.close();
	});

	it("registers resources across every documented resource type", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("project-a");
		const types = [
			"graph",
			"node",
			"schedule",
			"buffer",
			"subscription",
			"timer",
			"worker",
			"pendingLoad",
		] as const;
		for (const type of types) {
			scope.register(type, () => {});
		}

		const { resources } = runtime.diagnostics();
		expect(resources.total).toBe(types.length);
		for (const type of types) {
			expect(resources.byType[type]).toBe(1);
		}

		await runtime.close();
	});

	it("fifty project open/close cycles return resource counts to baseline using one context", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();
		const baselineResources = runtime.diagnostics().resources.total;

		for (let cycle = 0; cycle < 50; cycle++) {
			const scope = runtime.openProjectScope(`project-${cycle}`);
			const disposers = [vi.fn(), vi.fn(), vi.fn()];
			const handles = disposers.map((dispose) =>
				scope.register(cycle % 2 === 0 ? "node" : "schedule", dispose),
			);
			expect(runtime.diagnostics().resources.total).toBe(
				baselineResources + handles.length,
			);

			await scope.dispose();

			for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
			expect(runtime.diagnostics().resources.total).toBe(baselineResources);
		}

		// A single real-time context served all fifty cycles: no context-limit
		// error is even possible when only one is ever created.
		expect(runtime.diagnostics().contextsCreated).toBe(1);
		expect(runtime.getState()).not.toBe("closed");

		await runtime.close();
	});
});

describe("AudioRuntime HMR handoff", () => {
	it("getAudioRuntime() returns the same instance across fifty compatible reloads", () => {
		const runtime = AudioRuntimeModule.getAudioRuntime();
		runtime.ensureContext();

		for (let i = 0; i < 50; i++) {
			// Simulates fifty module re-evaluations reading the singleton fresh —
			// a compatible HMR replacement hands off the same runtime instead of
			// creating another context.
			expect(AudioRuntimeModule.getAudioRuntime()).toBe(runtime);
		}

		expect(runtime.diagnostics().contextsCreated).toBe(1);
		expect(runtime.getState()).not.toBe("closed");
	});

	it("an unavoidable replacement fully closes the previous runtime before installing a new one", async () => {
		const first = AudioRuntimeModule.getAudioRuntime();
		first.ensureContext();

		const second = await AudioRuntimeModule.replaceAudioRuntime();

		expect(second).not.toBe(first);
		expect(first.getState()).toBe("closed");
		expect(AudioRuntimeModule.getAudioRuntime()).toBe(second);
	});

	it("fifty consecutive incompatible replacements each close before the next opens, never overlapping", async () => {
		let previous = AudioRuntimeModule.getAudioRuntime();
		previous.ensureContext();

		for (let i = 0; i < 50; i++) {
			const next = await AudioRuntimeModule.replaceAudioRuntime();

			// The previous runtime's close() resolved (awaited by
			// replaceAudioRuntime) strictly before the new one is handed back.
			expect(previous.getState()).toBe("closed");
			expect(next).not.toBe(previous);
			expect(next.getState()).toBe("uninitialized");

			next.ensureContext();
			previous = next;
		}

		expect(previous.diagnostics().contextsCreated).toBe(1);
		// 51 real contexts were created across 51 runtimes (initial + 50
		// replacements) and every prior one was fully closed — at most one is
		// ever live at a time, so no context-limit error is reachable.
	});
});
