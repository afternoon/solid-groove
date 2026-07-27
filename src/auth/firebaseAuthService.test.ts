import { describe, expect, it, vi } from "vitest";

// Exercise the *Firebase* branch of `createAuthService()`. The sibling
// `authService.test.ts` forces `VITE_MOCK_BACKEND=true` at module scope so it
// only ever sees `MockAuthService`, which is why this lives in its own file.
vi.stubEnv("VITE_MOCK_BACKEND", "false");

// Reproduce what `src/firebaseConfig.ts` actually does with no Firebase config
// present: `getAuth(app)` throws in the module body, so the module fails to
// evaluate and every `import()` of it rejects. A throwing factory is how Vitest
// models that.
vi.mock("../firebaseConfig", () => {
	throw new Error("Firebase: Error (auth/invalid-api-key).");
});

describe("FirebaseAuthService construction", () => {
	it("leaves no unhandled rejection when nothing awaits it", async () => {
		// The regression this pins: `authService` is constructed at module scope, so
		// importing the module starts the `../firebaseConfig` import with no caller
		// to await it. Without a handler attached in the constructor, that rejected
		// promise surfaced as a process-level unhandled rejection and turned an
		// all-green Vitest run red ("Errors 1 error", exit 1) for any suite whose
		// import graph reached this module. It was intermittent, because whether the
		// rejection settled before teardown was a race.
		const unhandled: unknown[] = [];
		const record = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", record);

		try {
			const { createAuthService } = await import("./authService");
			createAuthService();

			// Give the rejection time to settle and Node time to decide it is
			// unhandled — that verdict is made after the microtask queue drains, so a
			// bare `await Promise.resolve()` is not enough to catch the regression.
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", record);
		}
	});

	it("still surfaces the failure to a caller that awaits a method", async () => {
		// The handler above must not swallow the error for real callers: attaching
		// one marks the promise handled without changing what an `await` sees. If
		// this ever resolves instead of rejecting, the fix has become a bug — a
		// sign-in that silently no-ops is far worse than one that fails loudly.
		//
		// Asserting only *that* it rejects, not the message: Vitest replaces a
		// throwing `vi.mock` factory's error with its own "There was an error when
		// mocking a module" wrapper, so the underlying `auth/invalid-api-key` text
		// is not observable here. The propagation is the contract; the wording is
		// Vitest's and would be brittle to pin.
		const { createAuthService } = await import("./authService");
		const service = createAuthService();

		await expect(service.signInAnonymously()).rejects.toThrow();
	});
});
