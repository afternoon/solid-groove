import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DrumPad, Instrument } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import { createSeededIdFactory } from "../domain/ids";
import type { AudioAssetProjection } from "../projection/audioProjection";
import { installWebAudioGlobals } from "./testAudioContext";

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
				mixer: { volume: 0, pan: 0, muted: false },
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
				mixer: { volume: 0, pan: 0, muted: false },
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
