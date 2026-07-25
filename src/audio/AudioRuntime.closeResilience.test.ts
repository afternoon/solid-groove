import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `close()` must always reach a terminal, reusable `"closed"` state — even
 * when the one disposer that actually talks to the browser,
 * `context.close()`, rejects (e.g. `InvalidStateError` from a context that
 * was already closing, a case the old `state !== "closed"` guard did not
 * cover because state can change during the preceding `await`). Before this
 * fix, that rejection propagated out of the async IIFE before `this.state =
 * "closed"` ever ran, so the runtime got stuck in `"closing"` forever:
 * `close()` kept returning that same rejected promise to every future
 * caller, and `resume()` — which awaits any in-flight `closePromise` —
 * never recovered either. Tested here against a fake Tone module so
 * `context.close()` can be made to reject deterministically; real-context
 * open/close behavior is covered in AudioRuntime.test.ts.
 */
vi.mock("tone", () => {
	// biome-ignore lint/suspicious/noExplicitAny: minimal fake, not the real Tone.Context shape
	let current: any = null;
	let nextCloseShouldReject = false;

	class Context {
		state: "suspended" | "running" | "closed" = "suspended";
		rawContext = { suspend: vi.fn(async () => {}) };
		constructor() {
			current = this;
		}
		async close() {
			if (nextCloseShouldReject) {
				nextCloseShouldReject = false;
				throw new Error("InvalidStateError: context is already closing");
			}
			this.state = "closed";
		}
	}

	return {
		Context,
		setContext: vi.fn((ctx: unknown) => {
			current = ctx;
		}),
		getContext: vi.fn(() => current),
		getDestination: vi.fn(() => ({})),
		start: vi.fn(async () => {
			if (current) current.state = "running";
		}),
		// Test-only controls, mirroring the reset hook in
		// AudioRuntime.resume.test.ts's fake Tone module.
		__resetForTest: () => {
			current = null;
			nextCloseShouldReject = false;
		},
		__rejectNextClose: () => {
			nextCloseShouldReject = true;
		},
	};
});

import * as Tone from "tone";
import { AudioRuntime } from "./AudioRuntime";

type ToneTestHooks = {
	__resetForTest: () => void;
	__rejectNextClose: () => void;
};

beforeEach(() => {
	(Tone as unknown as ToneTestHooks).__resetForTest();
});

describe("AudioRuntime.close resilience", () => {
	it("still resolves and reaches 'closed' when context.close() rejects", async () => {
		const runtime = new AudioRuntime();
		runtime.ensureContext();
		(Tone as unknown as ToneTestHooks).__rejectNextClose();

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await expect(runtime.close()).resolves.toBeUndefined();

		consoleError.mockRestore();
		expect(runtime.getState()).toBe("closed");
		expect(runtime.diagnostics().contextsCloseFailed).toBe(1);
		expect(runtime.diagnostics().contextsClosed).toBe(0);
	});

	it("a second close() after a rejected one does not return a stuck promise", async () => {
		const runtime = new AudioRuntime();
		runtime.ensureContext();
		(Tone as unknown as ToneTestHooks).__rejectNextClose();

		vi.spyOn(console, "error").mockImplementation(() => {});
		await runtime.close();
		vi.mocked(console.error).mockRestore();

		// Before this fix this awaited the same rejected promise forever.
		await expect(runtime.close()).resolves.toBeUndefined();
		expect(runtime.getState()).toBe("closed");
	});

	it("ensureContext()/resume() recover after a close() whose context.close() rejected", async () => {
		const runtime = new AudioRuntime();
		runtime.ensureContext();
		(Tone as unknown as ToneTestHooks).__rejectNextClose();

		vi.spyOn(console, "error").mockImplementation(() => {});
		await runtime.close();
		vi.mocked(console.error).mockRestore();

		// Before this fix, `resume()` awaits any in-flight `closePromise` —
		// which stayed rejected forever — so this would have hung/rejected
		// instead of standing up a fresh context.
		await expect(runtime.resume()).resolves.toBeUndefined();
		expect(runtime.getState()).toBe("running");
	});
});
