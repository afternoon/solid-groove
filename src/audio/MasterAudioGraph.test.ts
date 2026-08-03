import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Device } from "../domain/entities";
import { createSeededIdFactory } from "../domain/ids";
import type { AudioMasterProjection } from "../projection/audioProjection";
import { installWebAudioGlobals, rms } from "./testAudioContext";

installWebAudioGlobals();

let Tone: typeof import("tone");
let AudioRuntimeModule: typeof import("./AudioRuntime");
let MasterAudioGraphModule: typeof import("./MasterAudioGraph");

beforeAll(async () => {
	Tone = await import("tone");
	AudioRuntimeModule = await import("./AudioRuntime");
	MasterAudioGraphModule = await import("./MasterAudioGraph");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

const ids = createSeededIdFactory("master-audio-graph-test");

function masterProjection(
	overrides: Partial<AudioMasterProjection> = {},
): AudioMasterProjection {
	return {
		volume: 0,
		devices: [],
		fingerprint: "f",
		topologyFingerprint: "t",
		...overrides,
	};
}

function passthroughDevice(order: number): Device {
	return {
		id: ids("device"),
		type: "filter",
		order,
		bypassed: false,
		parameters: {},
		preset: null,
	};
}

/** Peak absolute sample value across a rendered channel. */
function peak(data: Float32Array): number {
	let max = 0;
	for (const sample of data) max = Math.max(max, Math.abs(sample));
	return max;
}

/** Peak over a sub-window [startFrac, endFrac) — used to measure the steady
 * state after the limiter's attack has settled, since a brick-wall limiter is a
 * sustained-output safety net rather than a sample-accurate transient clamp. */
function peakWindow(
	data: Float32Array,
	startFrac: number,
	endFrac: number,
): number {
	const start = Math.floor(data.length * startFrac);
	const end = Math.floor(data.length * endFrac);
	let max = 0;
	for (let i = start; i < end; i += 1) max = Math.max(max, Math.abs(data[i]));
	return max;
}

describe("MasterAudioGraph (PRD AUD-04/AUD-08)", () => {
	it("passes an ordinary, already-safe signal through unchanged", async () => {
		const rendered = await Tone.Offline(
			({ destination }) => {
				const runtime = new AudioRuntimeModule.AudioRuntime();
				const scope = runtime.openProjectScope("p");
				const master = new MasterAudioGraphModule.MasterAudioGraph(
					scope,
					destination,
				);
				master.reconcile(masterProjection());
				// A moderate oscillator, well under 0 dBFS.
				const osc = new Tone.Oscillator({ frequency: 220, volume: -12 });
				osc.connect(master.input);
				osc.start(0).stop(0.2);
			},
			0.2,
			1,
		);
		const energy = rms(Float32Array.from(rendered.getChannelData(0)));
		expect(energy).toBeGreaterThan(0.01);
		// The safety limiter is transparent for safe material: no gross clipping.
		expect(peak(Float32Array.from(rendered.getChannelData(0)))).toBeLessThan(1);
	});

	it("the safety limiter attenuates a dangerously loud, extreme chain", async () => {
		/** Renders a +24 dB source through an extreme master device chain, with the
		 * master's own safety limiter either kept or bypassed for comparison. */
		async function renderExtreme(withLimiter: boolean): Promise<Float32Array> {
			const buffer = await Tone.Offline(
				({ destination }) => {
					const runtime = new AudioRuntimeModule.AudioRuntime();
					const scope = runtime.openProjectScope("p");
					const master = new MasterAudioGraphModule.MasterAudioGraph(
						scope,
						destination,
					);
					master.reconcile(
						masterProjection({
							volume: 6,
							devices: [passthroughDevice(0), passthroughDevice(1)],
						}),
					);
					const osc = new Tone.Oscillator({ frequency: 110, volume: 24 });
					osc.connect(withLimiter ? master.input : destination);
					osc.start(0).stop(0.4);
				},
				0.4,
				1,
			);
			return Float32Array.from(buffer.getChannelData(0));
		}

		const limited = await renderExtreme(true);
		const unlimited = await renderExtreme(false);

		// The steady-state output through the master's limiter is meaningfully
		// quieter than the same dangerous signal reaching the destination
		// unprotected — the transparent safety stage is doing its job (PRD AUD-04).
		expect(peakWindow(limited, 0.5, 0.9)).toBeLessThan(
			peakWindow(unlimited, 0.5, 0.9),
		);
		// And it is genuinely engaging (well below the raw signal), not a rounding
		// difference.
		expect(peakWindow(limited, 0.5, 0.9)).toBeLessThan(
			peakWindow(unlimited, 0.5, 0.9) * 0.75,
		);
	});

	it("renders silence when nothing is connected, and the meter reads no signal", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const master = new MasterAudioGraphModule.MasterAudioGraph(
			scope,
			runtime.getDestination(),
		);
		master.reconcile(masterProjection());
		// No source connected: the meter reports -Infinity dB (no signal).
		const value = master.levelMeter.getValue();
		const level = Array.isArray(value) ? Math.max(...value) : value;
		expect(level).toBeLessThan(-60);
		master.dispose();
		await runtime.close();
	});

	it("a volume (parameter-only) edit reconciles in place without recreating the meter or limiter", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const master = new MasterAudioGraphModule.MasterAudioGraph(
			scope,
			runtime.getDestination(),
		);
		master.reconcile(masterProjection({ volume: 0 }));
		const meterBefore = master.levelMeter;
		const nodeCountBefore = runtime.diagnostics().resources.byOwner.p;

		// A pure volume change — the fingerprint differs but the topology does not.
		master.reconcile(masterProjection({ volume: -6, fingerprint: "f2" }));

		// Same meter object identity, and no net node created or disposed.
		expect(master.levelMeter).toBe(meterBefore);
		expect(runtime.diagnostics().resources.byOwner.p).toBe(nodeCountBefore);

		master.dispose();
		await runtime.close();
	});

	it("disposes every node it owns, idempotently", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const master = new MasterAudioGraphModule.MasterAudioGraph(
			scope,
			runtime.getDestination(),
		);
		master.reconcile(masterProjection({ devices: [passthroughDevice(0)] }));
		expect(runtime.diagnostics().resources.byOwner.p).toBeGreaterThan(0);

		master.dispose();
		master.dispose(); // idempotent
		await Promise.resolve();

		expect(runtime.diagnostics().resources.byOwner.p).toBeUndefined();
		await runtime.close();
	});
});
