import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";

// Must run before Tone is imported — see testAudioContext.ts.
installWebAudioGlobals();

let Tone: typeof import("tone");
let AudioRuntimeModule: typeof import("./AudioRuntime");

beforeAll(async () => {
	AudioRuntimeModule = await import("./AudioRuntime");
	Tone = await import("tone");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// Already closed/replaced by the test itself — fine.
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

describe("AudioRuntime transport continuity (PRD AUD-07/AUD-09)", () => {
	it("a tempo written to the transport before ensureContext() is ever called survives it", () => {
		// Mirrors what `SongPlayer.setProjectStore`'s effect does on load: it
		// writes the project's tempo to `Tone.getTransport().bpm` as soon as
		// the first store snapshot arrives, before any user gesture and
		// therefore before `AudioRuntime.ensureContext()` has ever run.
		// Importing "tone" above already constructed a live global
		// context/transport as a module-evaluation side effect (see
		// AudioRuntime.singleContext.test.ts) — this is exactly that
		// transport, since this is the first and only test to touch a
		// context in this file.
		Tone.getTransport().bpm.value = 145;

		const runtime = AudioRuntimeModule.getAudioRuntime();
		runtime.ensureContext();

		// Regression: the old `ensureContext()` unconditionally installed a
		// *different* context via `Tone.setContext(new Tone.Context())`,
		// whose transport starts back at Tone's default 120 BPM — silently
		// discarding the tempo already applied above. `SongPlayer.play()`
		// then started that new transport, so the sequence played at the
		// wrong tempo with no re-render of the effect that had set it
		// (`hasStarted` isn't reactive, and the tempo value itself never
		// changed, so nothing re-ran to reapply it).
		expect(Tone.getTransport().bpm.value).toBe(145);

		return runtime.close();
	});
});
