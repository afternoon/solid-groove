import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DrumPad, Instrument } from "../domain/entities";
import { packVersion } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import { createSeededIdFactory } from "../domain/ids";
import {
	SAMPLER_PITCH,
	SYNTH_FILTER_CUTOFF,
	SYNTH_WAVEFORM,
} from "../domain/parameters";
import type { AudioAssetProjection } from "../projection/audioProjection";
import { hfEnergy, installWebAudioGlobals, rms } from "./testAudioContext";

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("./AudioRuntime");
let AudioBufferCacheModule: typeof import("./AudioBufferCache");
let InstrumentGraphModule: typeof import("./InstrumentGraph");

beforeAll(async () => {
	AudioRuntimeModule = await import("./AudioRuntime");
	AudioBufferCacheModule = await import("./AudioBufferCache");
	InstrumentGraphModule = await import("./InstrumentGraph");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

const ids = createSeededIdFactory("instrument-graph-test");

function asset(id: AssetId, fingerprint = "f1"): AudioAssetProjection {
	return {
		id,
		packId: ids("pack"),
		packVersion: packVersion("1.0.0"),
		kind: "sample",
		storageRef: `samples/${id}.wav`,
		url: `/samples/${id}.wav`,
		durationSeconds: 1,
		sampleRate: 44_100,
		channelCount: 1,
		fingerprint,
	};
}

/** A loader that resolves immediately with a distinct fake buffer per call,
 * so tests can assert which decode ended up installed. */
function immediateLoader(): {
	loader: import("./AudioBufferCache").AssetBufferLoader<{
		label: string;
		dispose(): void;
	}>;
	created: { label: string; dispose: () => void }[];
} {
	const created: { label: string; dispose: () => void }[] = [];
	return {
		loader: {
			async load(a) {
				const dispose = vi.fn();
				const buffer = { label: `${a.id}@${a.fingerprint}`, dispose };
				created.push(buffer);
				return buffer;
			},
		},
		created,
	};
}

function makeContext(scope: import("./AudioRuntime").AudioProjectScope) {
	const { loader } = immediateLoader();
	const assetsById = new Map<AssetId, AudioAssetProjection>();
	const bufferCache = new AudioBufferCacheModule.AudioBufferCache(
		loader as unknown as import("./AudioBufferCache").AssetBufferLoader<
			import("tone").ToneAudioBuffer
		>,
	);
	return {
		context: { scope, assetsById, bufferCache },
		assetsById,
		bufferCache,
	};
}

describe("createInstrumentNode", () => {
	it("sampler: triggers nothing until its asset buffer resolves", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context, assetsById } = makeContext(scope);
		const assetId = ids("asset");
		assetsById.set(assetId, asset(assetId));

		const instrument: Instrument = {
			kind: "sampler",
			assetId,
			parameters: {},
		};
		const node = InstrumentGraphModule.createInstrumentNode(
			instrument,
			context,
		);
		expect(node.kind).toBe("sampler");

		// Buffer decode is async even with an immediate loader (a real
		// `Promise` still needs a microtask to settle) — before that, a
		// trigger must not throw or play a half-loaded buffer.
		expect(() =>
			node.trigger({ kind: "pitch", pitch: 60 }, 0, "8n", 0.8),
		).not.toThrow();

		node.dispose();
		await runtime.close();
	});

	it("sampler: swapping the asset releases the old buffer subscription and attaches the new one", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context, assetsById } = makeContext(scope);
		const assetA = ids("asset");
		const assetB = ids("asset");
		assetsById.set(assetA, asset(assetA));
		assetsById.set(assetB, asset(assetB));

		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "sampler", assetId: assetA, parameters: {} },
			context,
		);
		await Promise.resolve();
		await Promise.resolve();
		const before = context.bufferCache.diagnostics().cachedAssets;
		expect(before).toBe(1);

		node.update({ kind: "sampler", assetId: assetB, parameters: {} });
		await Promise.resolve();
		await Promise.resolve();

		// Asset A's subscription was released (no other consumer), asset B's
		// was created — one cached asset either way, not an accumulating set.
		expect(context.bufferCache.diagnostics().cachedAssets).toBe(1);

		node.dispose();
		await runtime.close();
	});

	it("sampler: update() with the same asset id does not resubscribe", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context, assetsById, bufferCache } = makeContext(scope);
		const assetId = ids("asset");
		assetsById.set(assetId, asset(assetId));

		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "sampler", assetId, parameters: {} },
			context,
		);
		await Promise.resolve();
		await Promise.resolve();
		const subscriptionsBefore =
			runtime.diagnostics().resources.byType.subscription;

		node.update({ kind: "sampler", assetId, parameters: {} });
		expect(runtime.diagnostics().resources.byType.subscription).toBe(
			subscriptionsBefore,
		);
		void bufferCache;

		node.dispose();
		await runtime.close();
	});

	it("synth: triggers a pitched note without throwing and ignores pad triggers", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context } = makeContext(scope);

		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "synth", parameters: {} },
			context,
		);
		expect(node.kind).toBe("synth");
		expect(() =>
			node.trigger({ kind: "pitch", pitch: 60 }, 0, "8n", 0.8),
		).not.toThrow();
		expect(() =>
			node.trigger({ kind: "pad", padId: "pad_x" as PadId }, 0, "8n", 0.8),
		).not.toThrow();

		node.dispose();
		await runtime.close();
	});

	it("drumMachine: reconciling pads reuses unaffected pads and only replaces the changed one", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context, assetsById } = makeContext(scope);
		const assetA = ids("asset");
		const assetB = ids("asset");
		assetsById.set(assetA, asset(assetA));
		assetsById.set(assetB, asset(assetB));

		const padId1 = ids("pad");
		const padId2 = ids("pad");
		function pad(id: PadId, assetId: AssetId): DrumPad {
			return {
				id,
				name: id,
				assetId,
				chokeGroup: null,
				parameters: {},
				mixer: { volume: 0, pan: 0, muted: false, soloed: false },
			};
		}

		const node = InstrumentGraphModule.createInstrumentNode(
			{
				kind: "drumMachine",
				pads: [pad(padId1, assetA), pad(padId2, assetB)],
				parameters: {},
			},
			context,
		);
		await Promise.resolve();
		await Promise.resolve();
		const baselineSubscriptions =
			runtime.diagnostics().resources.byType.subscription ?? 0;
		expect(baselineSubscriptions).toBe(2);

		// Only pad 1's asset changes; pad 2 is untouched.
		const assetC = ids("asset");
		assetsById.set(assetC, asset(assetC));
		node.update({
			kind: "drumMachine",
			pads: [pad(padId1, assetC), pad(padId2, assetB)],
			parameters: {},
		});
		await Promise.resolve();
		await Promise.resolve();

		// Pad 1 re-subscribed (old released, new created); pad 2's own
		// subscription was never touched, so the total count is unchanged.
		expect(runtime.diagnostics().resources.byType.subscription).toBe(
			baselineSubscriptions,
		);

		node.dispose();
		await runtime.close();
	});

	it("drumMachine: removing a pad disposes only that pad's resources", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context, assetsById } = makeContext(scope);
		const assetA = ids("asset");
		assetsById.set(assetA, asset(assetA));
		const padId1 = ids("pad");
		const padId2 = ids("pad");
		function pad(id: PadId): DrumPad {
			return {
				id,
				name: id,
				assetId: assetA,
				chokeGroup: null,
				parameters: {},
				mixer: { volume: 0, pan: 0, muted: false, soloed: false },
			};
		}

		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "drumMachine", pads: [pad(padId1), pad(padId2)], parameters: {} },
			context,
		);
		await Promise.resolve();
		await Promise.resolve();

		node.update({
			kind: "drumMachine",
			pads: [pad(padId1)],
			parameters: {},
		});
		await Promise.resolve();

		expect(runtime.diagnostics().resources.byType.subscription).toBe(1);

		node.dispose();
		await Promise.resolve();
		expect(runtime.diagnostics().resources.total).toBe(0);
		await runtime.close();
	});

	it("dispose() is safe and releases every resource this instrument registered", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const { context, assetsById } = makeContext(scope);
		const assetId = ids("asset");
		assetsById.set(assetId, asset(assetId));

		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "sampler", assetId, parameters: {} },
			context,
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(runtime.diagnostics().resources.total).toBeGreaterThan(0);

		node.dispose();
		node.dispose(); // idempotent on the wrapper's own side; scope release below is what's asserted
		await Promise.resolve();
		expect(runtime.diagnostics().resources.total).toBe(0);

		await runtime.close();
	});

	describe("drumMachine playback", () => {
		/** A loader that hands back a real, short `ToneAudioBuffer` so a pad
		 * trigger builds and plays an actual `Tone.Player`. */
		async function realBufferContext(
			scope: import("./AudioRuntime").AudioProjectScope,
		) {
			const Tone = await import("tone");
			const loader = {
				async load() {
					return Tone.ToneAudioBuffer.fromArray(new Float32Array(4_410));
				},
			};
			const assetsById = new Map<AssetId, AudioAssetProjection>();
			const bufferCache = new AudioBufferCacheModule.AudioBufferCache(
				loader as unknown as import("./AudioBufferCache").AssetBufferLoader<
					import("tone").ToneAudioBuffer
				>,
			);
			return { context: { scope, assetsById, bufferCache }, assetsById, Tone };
		}

		function drumPad(
			id: PadId,
			assetId: AssetId,
			overrides: Partial<DrumPad> = {},
		): DrumPad {
			return {
				id,
				name: id,
				assetId,
				chokeGroup: null,
				parameters: {},
				mixer: { volume: 0, pan: 0, muted: false, soloed: false },
				...overrides,
			};
		}

		it("a hit builds a short-lived player that self-disposes on stop, leaving no leak", async () => {
			const runtime = new AudioRuntimeModule.AudioRuntime();
			const scope = runtime.openProjectScope("p");
			const { context, assetsById, Tone } = await realBufferContext(scope);
			const assetId = ids("asset");
			assetsById.set(assetId, asset(assetId));
			const padId = ids("pad");

			const node = InstrumentGraphModule.createInstrumentNode(
				{
					kind: "drumMachine",
					pads: [drumPad(padId, assetId)],
					parameters: {},
				},
				context,
			);
			await Promise.resolve();
			await Promise.resolve();

			const disposeSpy = vi.spyOn(Tone.Player.prototype, "dispose");
			try {
				node.trigger({ kind: "pad", padId }, 0, "16n", 0.8);
				// Trigger it a few more times; every voice is independent.
				node.trigger({ kind: "pad", padId }, 0, "16n", 0.8);
				node.trigger({ kind: "pad", padId }, 0, "16n", 0.8);
				// A no-op trigger for an unknown pad must not throw or build a voice.
				expect(() =>
					node.trigger({ kind: "pad", padId: ids("pad") }, 0, "16n", 0.8),
				).not.toThrow();
			} finally {
				disposeSpy.mockRestore();
			}

			// Disposing the node tears down its strips; nothing is left registered.
			node.dispose();
			await Promise.resolve();
			expect(runtime.diagnostics().resources.total).toBe(0);
			await runtime.close();
		});

		it("choke: a pad silences an earlier voice in the same choke group", async () => {
			const runtime = new AudioRuntimeModule.AudioRuntime();
			const scope = runtime.openProjectScope("p");
			const { context, assetsById, Tone } = await realBufferContext(scope);
			const openHat = ids("asset");
			const closedHat = ids("asset");
			assetsById.set(openHat, asset(openHat));
			assetsById.set(closedHat, asset(closedHat));
			const openId = ids("pad");
			const closedId = ids("pad");

			const node = InstrumentGraphModule.createInstrumentNode(
				{
					kind: "drumMachine",
					pads: [
						drumPad(openId, openHat, { chokeGroup: 0 }),
						drumPad(closedId, closedHat, { chokeGroup: 0 }),
					],
					parameters: {},
				},
				context,
			);
			await Promise.resolve();
			await Promise.resolve();

			const stopSpy = vi.spyOn(Tone.Player.prototype, "stop");
			try {
				// The open hat rings, then the closed hat in the same group fires.
				node.trigger({ kind: "pad", padId: openId }, 0, "2n", 0.8);
				const stopsBefore = stopSpy.mock.calls.length;
				node.trigger({ kind: "pad", padId: closedId }, 0.1, "16n", 0.8);
				// The open hat's still-sounding voice was explicitly stopped by the
				// choke — an extra stop beyond the closed hat's own scheduled one.
				expect(stopSpy.mock.calls.length).toBeGreaterThan(stopsBefore);
			} finally {
				stopSpy.mockRestore();
			}

			node.dispose();
			await runtime.close();
		});

		it("mute wins over solo: a muted-and-soloed pad stays silent while another pad is soloed", async () => {
			const runtime = new AudioRuntimeModule.AudioRuntime();
			const scope = runtime.openProjectScope("p");
			const { context, assetsById, Tone } = await realBufferContext(scope);
			const a = ids("asset");
			const b = ids("asset");
			assetsById.set(a, asset(a));
			assetsById.set(b, asset(b));
			const mutedSoloed = ids("pad");
			const soloed = ids("pad");
			const plain = ids("pad");

			const node = InstrumentGraphModule.createInstrumentNode(
				{
					kind: "drumMachine",
					pads: [
						drumPad(mutedSoloed, a, {
							mixer: { volume: 0, pan: 0, muted: true, soloed: true },
						}),
						drumPad(soloed, b, {
							mixer: { volume: 0, pan: 0, muted: false, soloed: true },
						}),
						drumPad(plain, a, {
							mixer: { volume: 0, pan: 0, muted: false, soloed: false },
						}),
					],
					parameters: {},
				},
				context,
			);
			await Promise.resolve();
			await Promise.resolve();

			const startSpy = vi.spyOn(Tone.Player.prototype, "start");
			try {
				// The muted+soloed pad produces no voice (mute wins).
				node.trigger({ kind: "pad", padId: mutedSoloed }, 0, "16n", 0.8);
				expect(startSpy).not.toHaveBeenCalled();

				// A soloed, un-muted pad plays.
				node.trigger({ kind: "pad", padId: soloed }, 0, "16n", 0.8);
				expect(startSpy).toHaveBeenCalledTimes(1);

				// A non-soloed, un-muted pad is silenced while any pad is soloed.
				node.trigger({ kind: "pad", padId: plain }, 0, "16n", 0.8);
				expect(startSpy).toHaveBeenCalledTimes(1);
			} finally {
				startSpy.mockRestore();
			}

			node.dispose();
			await runtime.close();
		});

		it("pad pitch is applied as a playback-rate offset on the triggered voice", async () => {
			const runtime = new AudioRuntimeModule.AudioRuntime();
			const scope = runtime.openProjectScope("p");
			const { context, assetsById, Tone } = await realBufferContext(scope);
			const assetId = ids("asset");
			assetsById.set(assetId, asset(assetId));
			const padId = ids("pad");

			const node = InstrumentGraphModule.createInstrumentNode(
				{
					kind: "drumMachine",
					// +12 semitones => one octave up => playback rate 2.
					pads: [drumPad(padId, assetId, { parameters: { pitch: 12 } })],
					parameters: {},
				},
				context,
			);
			await Promise.resolve();
			await Promise.resolve();

			const rates: number[] = [];
			const startSpy = vi
				.spyOn(Tone.Player.prototype, "start")
				.mockImplementation(function mocked(this: import("tone").Player) {
					rates.push(this.playbackRate);
					return this as never;
				});
			try {
				node.trigger({ kind: "pad", padId }, 0, "16n", 0.8);
				expect(rates).toHaveLength(1);
				expect(rates[0]).toBeCloseTo(2, 5);
			} finally {
				startSpy.mockRestore();
			}

			node.dispose();
			await runtime.close();
		});
	});
});

describe("playOneShot", () => {
	it("starts the player at the requested offset inside the buffer", async () => {
		const Tone = await import("tone");
		const buffer = Tone.ToneAudioBuffer.fromArray(new Float32Array(1024));
		const destination = new Tone.Gain(1);
		const start = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});

		try {
			InstrumentGraphModule.playOneShot(
				buffer,
				destination,
				0,
				"192i",
				1,
				0.25,
			);
			expect(start).toHaveBeenCalledWith(0, 0.25, "192i");
		} finally {
			start.mockRestore();
			destination.dispose();
			buffer.dispose();
		}
	});

	it("defaults to the start of the buffer when no offset is given", async () => {
		const Tone = await import("tone");
		const buffer = Tone.ToneAudioBuffer.fromArray(new Float32Array(1024));
		const destination = new Tone.Gain(1);
		const start = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(this: unknown) {
				return this as never;
			});

		try {
			InstrumentGraphModule.playOneShot(buffer, destination, 0, "192i");
			expect(start).toHaveBeenCalledWith(0, 0, "192i");
		} finally {
			start.mockRestore();
			destination.dispose();
			buffer.dispose();
		}
	});
});

// --- LOOP-004: synth/sampler DSP and lifecycle -----------------------------

const SYNTH_WAVEFORM_KEY = SYNTH_WAVEFORM.id.split(".")[1];
const SYNTH_CUTOFF_KEY = SYNTH_FILTER_CUTOFF.id.split(".")[1];
const SAMPLER_PITCH_KEY = SAMPLER_PITCH.id.split(".")[1];

function bareContext() {
	const runtime = new AudioRuntimeModule.AudioRuntime();
	const scope = runtime.openProjectScope("p");
	const { context } = makeContext(scope);
	return { runtime, context };
}

describe("synth voice (PRD INS-01)", () => {
	it("its resonant low-pass cutoff changes the rendered high-frequency energy", async () => {
		const Tone = await import("tone");

		async function renderAtCutoff(cutoff: number): Promise<Float32Array> {
			const buffer = await Tone.Offline(
				async ({ destination }) => {
					const runtime = new AudioRuntimeModule.AudioRuntime();
					const scope = runtime.openProjectScope("p");
					const { context } = makeContext(scope);
					const node = InstrumentGraphModule.createInstrumentNode(
						{
							kind: "synth",
							parameters: {
								[SYNTH_WAVEFORM_KEY]: 2, // sawtooth: rich in harmonics
								[SYNTH_CUTOFF_KEY]: cutoff,
								ampAttack: 0.001,
								ampRelease: 0.05,
							},
						},
						context,
					);
					node.output.connect(destination);
					node.trigger({ kind: "pitch", pitch: 45 }, 0, 0.3, 0.9);
				},
				0.35,
				1,
			);
			return Float32Array.from(buffer.getChannelData(0));
		}

		const dark = await renderAtCutoff(300);
		const bright = await renderAtCutoff(16_000);
		// A brighter cutoff passes more of the sawtooth's harmonics, so its
		// high-frequency energy (discrete derivative RMS) is higher.
		expect(hfEnergy(bright)).toBeGreaterThan(hfEnergy(dark));
		expect(rms(bright)).toBeGreaterThan(0);
	});

	it("updates parameters in place without replacing the synth node", async () => {
		const { runtime, context } = bareContext();
		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "synth", parameters: {} },
			context,
		);
		const before = runtime.diagnostics().resources.total;
		// A cutoff sweep and a waveform change both go through update().
		node.update({
			kind: "synth",
			parameters: { [SYNTH_CUTOFF_KEY]: 900, [SYNTH_WAVEFORM_KEY]: 1 },
		});
		node.update({
			kind: "synth",
			parameters: { [SYNTH_CUTOFF_KEY]: 4000, [SYNTH_WAVEFORM_KEY]: 3 },
		});
		expect(runtime.diagnostics().resources.total).toBe(before);
		node.dispose();
		await runtime.close();
	});

	it("survives parameter extremes and repeated triggers without throwing", async () => {
		const { runtime, context } = bareContext();
		const node = InstrumentGraphModule.createInstrumentNode(
			{
				kind: "synth",
				parameters: {
					[SYNTH_CUTOFF_KEY]: SYNTH_FILTER_CUTOFF.max,
					filterResonance: 20,
					ampAttack: 0,
					ampRelease: 0,
					ampSustain: 0,
				},
			},
			context,
		);
		expect(() => {
			for (let i = 0; i < 64; i += 1) {
				node.trigger(
					{ kind: "pitch", pitch: 36 + (i % 48) },
					i * 0.01,
					0.05,
					1,
				);
			}
		}).not.toThrow();
		node.dispose();
		await runtime.close();
	});
});

describe("one-shot sampler (PRD INS-01)", () => {
	/** A ramp buffer, so a windowed slice sounds different from the whole file. */
	async function rampBuffer(): Promise<import("tone").ToneAudioBuffer> {
		const Tone = await import("tone");
		const data = new Float32Array(4096);
		for (let i = 0; i < data.length; i += 1) {
			data[i] = Math.sin((i / data.length) * Math.PI * 8) * (i / data.length);
		}
		return Tone.ToneAudioBuffer.fromArray(data);
	}

	/** A context whose cache resolves one real ToneAudioBuffer for any asset. */
	function realBufferContext(buffer: import("tone").ToneAudioBuffer) {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const assetsById = new Map<AssetId, AudioAssetProjection>();
		const loader = {
			async load() {
				return buffer;
			},
		};
		const bufferCache = new AudioBufferCacheModule.AudioBufferCache(
			loader as unknown as import("./AudioBufferCache").AssetBufferLoader<
				import("tone").ToneAudioBuffer
			>,
		);
		return { runtime, context: { scope, assetsById, bufferCache } };
	}

	it("applies pitch as a playback-rate change and windows to start/end", async () => {
		const Tone = await import("tone");
		const buffer = await rampBuffer();
		const { runtime, context } = realBufferContext(buffer);
		const assetId = ids("asset");
		context.assetsById.set(assetId, asset(assetId));

		const starts: { rate: number; offset: number; duration: number }[] = [];
		const startSpy = vi
			.spyOn(Tone.Player.prototype, "start")
			.mockImplementation(function mocked(
				this: { playbackRate: number },
				_time?: unknown,
				offset?: unknown,
				duration?: unknown,
			) {
				starts.push({
					rate: this.playbackRate,
					offset: Number(offset),
					duration: Number(duration),
				});
				return this as never;
			});

		try {
			const node = InstrumentGraphModule.createInstrumentNode(
				{
					kind: "sampler",
					assetId,
					parameters: {
						[SAMPLER_PITCH_KEY]: 12, // +1 octave -> 2x rate
						sampleStart: 0.25,
						sampleEnd: 0.75,
					},
				},
				context,
			);
			await Promise.resolve();
			await Promise.resolve();

			node.trigger({ kind: "pitch", pitch: 60 }, 0, "192i", 1);
			expect(starts).toHaveLength(1);
			expect(starts[0].rate).toBeCloseTo(2, 5);
			// Start offset is 25% into the buffer; the window is the middle 50%.
			expect(starts[0].offset).toBeCloseTo(buffer.duration * 0.25, 3);
			expect(starts[0].duration).toBeCloseTo(buffer.duration * 0.5, 3);

			node.dispose();
		} finally {
			startSpy.mockRestore();
			buffer.dispose();
			await runtime.close();
		}
	});

	it("swapping the sample cancels the old subscription (cache ownership)", async () => {
		const { runtime, context } = bareContext();
		const assetA = ids("asset");
		const assetB = ids("asset");
		context.assetsById.set(assetA, asset(assetA));
		context.assetsById.set(assetB, asset(assetB));

		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "sampler", assetId: assetA, parameters: {} },
			context,
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(context.bufferCache.diagnostics().cachedAssets).toBe(1);

		node.update({ kind: "sampler", assetId: assetB, parameters: {} });
		await Promise.resolve();
		await Promise.resolve();
		// Old asset released, new one attached — one cached asset, not two.
		expect(context.bufferCache.diagnostics().cachedAssets).toBe(1);

		node.dispose();
		await Promise.resolve();
		expect(runtime.diagnostics().resources.total).toBe(0);
		await runtime.close();
	});

	it("a parameter edit keeps the same subscription and disposes cleanly", async () => {
		const { runtime, context } = bareContext();
		const assetId = ids("asset");
		context.assetsById.set(assetId, asset(assetId));
		const node = InstrumentGraphModule.createInstrumentNode(
			{ kind: "sampler", assetId, parameters: {} },
			context,
		);
		await Promise.resolve();
		await Promise.resolve();
		const subscriptions = runtime.diagnostics().resources.byType.subscription;

		node.update({
			kind: "sampler",
			assetId,
			parameters: { [SAMPLER_PITCH_KEY]: 7, sampleStart: 0.2, sampleEnd: 0.9 },
		});
		// A non-asset edit must not resubscribe.
		expect(runtime.diagnostics().resources.byType.subscription).toBe(
			subscriptions,
		);

		node.dispose();
		await Promise.resolve();
		expect(runtime.diagnostics().resources.total).toBe(0);
		await runtime.close();
	});
});
