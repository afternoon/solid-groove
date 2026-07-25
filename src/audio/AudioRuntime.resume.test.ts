import { describe, expect, it, vi } from "vitest";

/**
 * `resume()`'s own logic — call `Tone.start()` only when needed, wait out an
 * in-flight `close()`, and mark the runtime running — is independent of
 * whether a live `AudioContext` actually completes its browser resume
 * handshake. Tested here against a fake Tone module instead of the real one:
 * `AudioRuntime.test.ts` already covers `ensureContext()`/`close()` against a
 * genuine Tone context (reliable in this environment), but a live
 * `AudioContext.resume()` depends on an audio callback this sandbox has no
 * device to fire — see the comment at the top of that file.
 */
vi.mock("tone", () => {
	// biome-ignore lint/suspicious/noExplicitAny: minimal fake, not the real Tone.Context shape
	let current: any = null;

	class Context {
		state: "suspended" | "running" | "closed" = "suspended";
		rawContext = { suspend: vi.fn(async () => {}) };
		constructor() {
			current = this;
		}
		async close() {
			this.state = "closed";
		}
	}

	const start = vi.fn(async () => {
		if (current) current.state = "running";
	});

	return {
		Context,
		setContext: vi.fn((ctx: unknown) => {
			current = ctx;
		}),
		getDestination: vi.fn(() => ({})),
		start,
	};
});

import * as Tone from "tone";
import { AudioRuntime } from "./AudioRuntime";

describe("AudioRuntime.resume", () => {
	it("creates the context if needed, calls Tone.start(), and marks the runtime running", async () => {
		const runtime = new AudioRuntime();
		expect(runtime.getState()).toBe("uninitialized");

		await runtime.resume();

		expect(Tone.start).toHaveBeenCalledTimes(1);
		expect(runtime.getState()).toBe("running");
		expect(runtime.diagnostics().contextsCreated).toBe(1);
	});

	it("does not call Tone.start() again once the context is already running", async () => {
		const runtime = new AudioRuntime();
		await runtime.resume();
		vi.mocked(Tone.start).mockClear();

		await runtime.resume();

		expect(Tone.start).not.toHaveBeenCalled();
		expect(runtime.getState()).toBe("running");
	});

	it("waits for an in-flight close() to settle before resuming a fresh context", async () => {
		const runtime = new AudioRuntime();
		await runtime.resume();

		const closePromise = runtime.close();
		const resumePromise = runtime.resume();

		await closePromise;
		await resumePromise;

		expect(runtime.getState()).toBe("running");
		// The close finished before the second resume created its context.
		expect(runtime.diagnostics().contextsCreated).toBe(2);
		expect(runtime.diagnostics().contextsClosed).toBe(1);
	});
});
