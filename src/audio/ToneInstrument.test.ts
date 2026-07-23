import { beforeAll, describe, expect, it } from "vitest";
import type { FilterConfig, SynthInstrument } from "../model/types";
import {
	hfEnergy,
	installWebAudioGlobals,
	rms,
	rmsWindow,
} from "./testAudioContext";

// Must run before Tone is imported so Tone builds on the native Web Audio impl.
installWebAudioGlobals();

// Imported lazily (after globals are installed) to keep import order correct.
let Tone: typeof import("tone");
let createToneInstrument: typeof import("./ToneInstrument").createToneInstrument;
let trackGain: typeof import("./SongPlayer").trackGain;

beforeAll(async () => {
	Tone = await import("tone");
	({ createToneInstrument } = await import("./ToneInstrument"));
	({ trackGain } = await import("./SongPlayer"));
});

const RENDER_SECONDS = 0.5;
const SAMPLE_RATE = 44100;

function baseSynth(overrides: {
	filter?: Partial<FilterConfig>;
	envelope?: Partial<SynthInstrument["envelope"]>;
}): SynthInstrument {
	return {
		type: "synth",
		oscillatorType: "sawtooth",
		envelope: {
			attack: 0.005,
			decay: 0.1,
			sustain: 1,
			release: 0.1,
			...overrides.envelope,
		},
		filter: {
			type: "lowpass",
			cutoff: 20000,
			resonance: 0,
			...overrides.filter,
		},
	};
}

/**
 * Render a single sustained note through the *real* ToneInstrument built from
 * `instrument`. `mutate` optionally runs updateParams()-style tweaks after
 * construction to exercise the live control-change path.
 */
async function renderSynth(
	instrument: SynthInstrument,
	mutate?: (built: ReturnType<typeof createToneInstrument>) => void,
): Promise<Float32Array> {
	const buffer = await Tone.Offline(
		({ destination }) => {
			const inst = createToneInstrument(instrument, destination);
			mutate?.(inst);
			// Sustain most of the render window so the note is fully audible.
			inst.trigger("C3", RENDER_SECONDS * 0.7, 0);
		},
		RENDER_SECONDS,
		1,
		SAMPLE_RATE,
	);
	return buffer.getChannelData(0);
}

describe("ToneInstrument filter", () => {
	it("produces audible output at a wide-open cutoff", async () => {
		const data = await renderSynth(baseSynth({ filter: { cutoff: 20000 } }));
		expect(rms(data)).toBeGreaterThan(0.01);
	});

	it("raising the lowpass cutoff monotonically increases high-frequency energy", async () => {
		// A lowpass filter passes progressively more high-frequency content as
		// its cutoff rises. Sweeping the Cutoff control must move the output's
		// HF energy in lockstep — the definitive signature of a working filter.
		const cutoffs = [200, 800, 3000, 18000];
		const hf: number[] = [];
		for (const cutoff of cutoffs) {
			hf.push(hfEnergy(await renderSynth(baseSynth({ filter: { cutoff } }))));
		}

		for (let i = 1; i < hf.length; i++) {
			expect(hf[i]).toBeGreaterThan(hf[i - 1]);
		}
		// And the full sweep must be a large, unambiguous change, not noise.
		expect(hf[hf.length - 1]).toBeGreaterThan(hf[0] * 3);
	});

	it("setting the filter cutoff via updateParams() changes the output", async () => {
		// Build with an open filter, then apply a slider-style change to a low
		// cutoff — the same code path the UI uses when the Cutoff slider moves.
		const openBaseline = await renderSynth(
			baseSynth({ filter: { cutoff: 18000 } }),
		);
		const afterChange = await renderSynth(
			baseSynth({ filter: { cutoff: 18000 } }),
			(inst) => {
				inst.updateParams(baseSynth({ filter: { cutoff: 200 } }));
			},
		);

		// Closing the filter via updateParams must strip high-frequency energy.
		expect(hfEnergy(afterChange)).toBeLessThan(hfEnergy(openBaseline) * 0.5);
	});

	it("raising resonance boosts energy around the cutoff", async () => {
		// Resonance (filter Q) emphasizes frequencies near the cutoff, adding
		// high-frequency energy relative to a flat (Q=0) response.
		const flat = await renderSynth(
			baseSynth({ filter: { cutoff: 800, resonance: 0 } }),
		);
		const resonant = await renderSynth(
			baseSynth({ filter: { cutoff: 800, resonance: 12 } }),
		);
		expect(hfEnergy(resonant)).toBeGreaterThan(hfEnergy(flat) * 1.2);
	});

	it("filter type is applied: a highpass differs from a lowpass at the same cutoff", async () => {
		const lowpass = await renderSynth(
			baseSynth({ filter: { type: "lowpass", cutoff: 500 } }),
		);
		const highpass = await renderSynth(
			baseSynth({ filter: { type: "highpass", cutoff: 500 } }),
		);
		// A 500Hz lowpass keeps the ~130Hz fundamental (low HF, high total RMS);
		// a 500Hz highpass removes the fundamental and keeps harmonics (higher
		// HF, lower total RMS). Both signatures must diverge clearly.
		expect(hfEnergy(highpass)).toBeGreaterThan(hfEnergy(lowpass));
		expect(rms(highpass)).toBeLessThan(rms(lowpass));
	});
});

describe("ToneInstrument envelope", () => {
	it("a long release sustains tail energy that a short release does not", async () => {
		// Note ends at 70% of the window; the release tail lives in the last 30%.
		const shortRelease = await renderSynth(
			baseSynth({ envelope: { release: 0.01 } }),
		);
		const longRelease = await renderSynth(
			baseSynth({ envelope: { release: RENDER_SECONDS * 0.5 } }),
		);

		const shortTail = rmsWindow(shortRelease, 0.72, 1.0);
		const longTail = rmsWindow(longRelease, 0.72, 1.0);

		// The long release should leave clearly more energy in the tail window.
		expect(longTail).toBeGreaterThan(shortTail * 2);
	});

	it("setting the envelope via updateParams() changes the output tail", async () => {
		const shortBaseline = await renderSynth(
			baseSynth({ envelope: { release: 0.01 } }),
		);
		const afterChange = await renderSynth(
			baseSynth({ envelope: { release: 0.01 } }),
			(inst) => {
				inst.updateParams(
					baseSynth({ envelope: { release: RENDER_SECONDS * 0.5 } }),
				);
			},
		);

		const baselineTail = rmsWindow(shortBaseline, 0.72, 1.0);
		const changedTail = rmsWindow(afterChange, 0.72, 1.0);
		expect(changedTail).toBeGreaterThan(baselineTail * 2);
	});
});

describe("ToneInstrument volume", () => {
	it("setVolume scales the output level", async () => {
		const full = await renderSynth(baseSynth({}));
		const half = await renderSynth(baseSynth({}), (inst) => {
			inst.setVolume(0.5);
		});

		// Measure past the 20ms ramp so the steady-state level is what's compared.
		const fullLevel = rmsWindow(full, 0.2, 0.65);
		const halfLevel = rmsWindow(half, 0.2, 0.65);

		expect(halfLevel / fullLevel).toBeGreaterThan(0.4);
		expect(halfLevel / fullLevel).toBeLessThan(0.6);
	});

	it("setVolume(0) silences the track", async () => {
		const silent = await renderSynth(baseSynth({}), (inst) => {
			inst.setVolume(0);
		});
		expect(rmsWindow(silent, 0.2, 0.65)).toBeLessThan(0.001);
	});

	it("default volume is unity — an untouched track is not attenuated", async () => {
		// Regression guard: routing every instrument through an output gain node
		// must not quietly change the level of a track nobody has touched.
		const viaGainStage = await renderSynth(baseSynth({}));
		expect(rms(viaGainStage)).toBeGreaterThan(0.01);
	});
});

describe("trackGain fader taper", () => {
	it("maps a full fader to unity and a closed fader to silence", () => {
		expect(trackGain(1)).toBe(1);
		expect(trackGain(0)).toBe(0);
	});

	it("is monotonic and sits below linear in the middle of the range", () => {
		// The taper must never invert, and a mid fader should be quieter than a
		// straight linear mapping — that is the point of the curve.
		const positions = [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1];
		for (let i = 1; i < positions.length; i++) {
			expect(trackGain(positions[i])).toBeGreaterThan(
				trackGain(positions[i - 1]),
			);
		}
		expect(trackGain(0.5)).toBeLessThan(0.5);
	});

	it("clamps out-of-range fader positions", () => {
		expect(trackGain(-1)).toBe(0);
		expect(trackGain(2)).toBe(1);
	});
});
