import * as nwaa from "node-web-audio-api";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * A regression guard for the exact bug `ensureContext()`'s adoption logic
 * fixes (PRD AUD-07/AUD-09): `import * as Tone from "tone"` has a
 * module-evaluation side effect that constructs a real `AudioContext`
 * before any application code runs, and the old `ensureContext()`
 * unconditionally constructed a *second* one on top of it — orphaning the
 * first, since it was never registered and `close()` only ever knew about
 * the one the runtime itself had created.
 *
 * This counts genuine native `AudioContext` constructions, wrapped in
 * globally before "tone" (or anything that transitively imports it) is
 * ever imported in this file. That ordering matters:
 * `standardized-audio-context` (which Tone.js builds on) resolves
 * `window.AudioContext` once, at its own module-evaluation time, so
 * wrapping the global after that point would silently observe nothing —
 * see `testAudioContext.ts` for the same constraint applied to the rest of
 * this suite's Web Audio globals.
 */
let constructions = 0;

class CountingAudioContext extends nwaa.AudioContext {
	constructor(...args: ConstructorParameters<typeof nwaa.AudioContext>) {
		super(...args);
		constructions++;
	}
}

for (const [key, impl] of Object.entries({
	...nwaa,
	AudioContext: CountingAudioContext,
})) {
	if (impl && !(key in globalThis)) {
		(globalThis as unknown as Record<string, unknown>)[key] = impl;
	}
}

let AudioRuntimeModule: typeof import("./AudioRuntime");

beforeAll(async () => {
	// This import alone triggers Tone's module-load side effect
	// (`getContext()` inside its barrel module), constructing the first —
	// and, after this fix, the *only* — real `AudioContext`.
	AudioRuntimeModule = await import("./AudioRuntime");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// Already closed/replaced by the test itself — fine.
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

describe("AudioRuntime single real-time context (AUD-07/AUD-09)", () => {
	it("ensureContext() adopts Tone's module-load context instead of constructing a second one", () => {
		expect(constructions).toBe(1);

		const runtime = new AudioRuntimeModule.AudioRuntime();
		runtime.ensureContext();

		// The regression: this used to be 2 — one `AudioContext` from Tone's
		// own import-time side effect, and an unreachable second one from
		// `ensureContext()` unconditionally calling `new Tone.Context()`.
		expect(constructions).toBe(1);
		expect(runtime.diagnostics().contextsCreated).toBe(0);
		expect(runtime.diagnostics().contextsAdopted).toBe(1);

		return runtime.close();
	});

	it("a project open/close cycle never constructs a context of its own", async () => {
		const runtime = AudioRuntimeModule.getAudioRuntime();
		runtime.ensureContext();
		const afterEnsure = constructions;

		const scope = runtime.openProjectScope("project-a");
		scope.register("node", () => {});
		await scope.dispose();
		await runtime.close();

		// Opening and disposing a project scope never touches the real-time
		// context — exactly the guarantee `openProjectScope()`/`dispose()`
		// document (PRD AUD-07). Whatever `ensureContext()` settled on above
		// (adopted or created — see the previous test) must be the only
		// construction attributable to this cycle.
		expect(constructions).toBe(afterEnsure);
	});
});
