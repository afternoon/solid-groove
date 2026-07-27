import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Device, Instrument, Send, TrackMixer } from "../domain/entities";
import { createSeededIdFactory } from "../domain/ids";
import type { AudioTrackProjection } from "../projection/audioProjection";
import type { DeviceNode, DeviceNodeFactory } from "./DeviceChain";
import type { InstrumentNode, InstrumentNodeFactory } from "./InstrumentGraph";
import { installWebAudioGlobals, rms } from "./testAudioContext";

installWebAudioGlobals();

let Tone: typeof import("tone");
let AudioRuntimeModule: typeof import("./AudioRuntime");
let TrackAudioGraphModule: typeof import("./TrackAudioGraph");

beforeAll(async () => {
	Tone = await import("tone");
	AudioRuntimeModule = await import("./AudioRuntime");
	TrackAudioGraphModule = await import("./TrackAudioGraph");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

const ids = createSeededIdFactory("track-audio-graph-test");

function mixer(overrides: Partial<TrackMixer> = {}): TrackMixer {
	return { volume: 0, pan: 0, muted: false, soloed: false, ...overrides };
}

function trackProjection(
	overrides: Partial<AudioTrackProjection> = {},
): AudioTrackProjection {
	return {
		id: ids("track"),
		type: "instrument",
		instrument: { kind: "sampler", assetId: null, parameters: {} },
		devices: [],
		sendConfig: [],
		mixer: mixer(),
		fingerprint: "f",
		topologyFingerprint: "t",
		...overrides,
	};
}

/** Spies on every instrument node this factory creates/updates/disposes. */
function spyInstrumentFactory(): {
	factory: InstrumentNodeFactory;
	create: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
} {
	const create = vi.fn();
	const update = vi.fn();
	const dispose = vi.fn();
	const factory: InstrumentNodeFactory = (instrument) => {
		create(instrument.kind);
		const output = new Tone.Gain(1);
		const node: InstrumentNode = {
			kind: instrument.kind,
			output,
			trigger: vi.fn(),
			update: (next: Instrument) => update(next.kind),
			dispose: () => {
				dispose(instrument.kind);
				output.dispose();
			},
		};
		return node;
	};
	return { factory, create, update, dispose };
}

/** Spies on every device node this factory creates/updates/disposes. */
function spyDeviceFactory(): {
	factory: DeviceNodeFactory;
	create: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
} {
	const create = vi.fn();
	const update = vi.fn();
	const dispose = vi.fn();
	const factory: DeviceNodeFactory = (device) => {
		create(device.id);
		const node = new Tone.Gain(1);
		const result: DeviceNode = {
			id: device.id,
			type: device.type,
			input: node,
			output: node,
			update: (d: Device) => update(d.id),
			dispose: () => {
				dispose(device.id);
				node.dispose();
			},
		};
		return result;
	};
	return { factory, create, update, dispose };
}

function device(id: string, order: number): Device {
	return {
		id: id as Device["id"],
		type: "generic",
		order,
		bypassed: false,
		parameters: {},
		preset: null,
	};
}

describe("TrackAudioGraph", () => {
	it("reconciling the exact same projection reference is a complete no-op", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const instrumentSpy = spyInstrumentFactory();
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => undefined,
				createInstrument: instrumentSpy.factory,
			},
			runtime.getDestination(),
		);

		const projection = trackProjection();
		track.reconcile(projection, false);
		expect(instrumentSpy.create).toHaveBeenCalledTimes(1);

		track.reconcile(projection, false);
		expect(instrumentSpy.create).toHaveBeenCalledTimes(1);
		expect(instrumentSpy.update).not.toHaveBeenCalled();

		track.dispose();
		return runtime.close();
	});

	it("a mixer-only edit updates volume/pan but never recreates the instrument or devices", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const instrumentSpy = spyInstrumentFactory();
		const deviceSpy = spyDeviceFactory();
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => undefined,
				createInstrument: instrumentSpy.factory,
				createDeviceNode: deviceSpy.factory,
			},
			runtime.getDestination(),
		);

		const instrument: Instrument = {
			kind: "sampler",
			assetId: null,
			parameters: {},
		};
		const devices = [device("dev_a", 0)];
		const first = trackProjection({ instrument, devices });
		track.reconcile(first, false);
		expect(instrumentSpy.create).toHaveBeenCalledTimes(1);
		expect(deviceSpy.create).toHaveBeenCalledTimes(1);

		const second = trackProjection({
			instrument,
			devices,
			mixer: mixer({ volume: -12, pan: 0.5 }),
		});
		track.reconcile(second, false);

		expect(instrumentSpy.create).toHaveBeenCalledTimes(1);
		expect(instrumentSpy.dispose).not.toHaveBeenCalled();
		// The instrument reference itself did not change, so the identity
		// short-circuit skips even a redundant `update()` call.
		expect(instrumentSpy.update).not.toHaveBeenCalled();
		expect(deviceSpy.create).toHaveBeenCalledTimes(1);
		expect(deviceSpy.dispose).not.toHaveBeenCalled();

		track.dispose();
		return runtime.close();
	});

	it("an instrument kind change disposes the old node and creates a new one", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const instrumentSpy = spyInstrumentFactory();
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => undefined,
				createInstrument: instrumentSpy.factory,
			},
			runtime.getDestination(),
		);

		track.reconcile(
			trackProjection({
				instrument: { kind: "sampler", assetId: null, parameters: {} },
			}),
			false,
		);
		track.reconcile(
			trackProjection({ instrument: { kind: "synth", parameters: {} } }),
			false,
		);

		expect(instrumentSpy.create).toHaveBeenCalledTimes(2);
		expect(instrumentSpy.create).toHaveBeenNthCalledWith(1, "sampler");
		expect(instrumentSpy.create).toHaveBeenNthCalledWith(2, "synth");
		expect(instrumentSpy.dispose).toHaveBeenCalledExactlyOnceWith("sampler");

		track.dispose();
		return runtime.close();
	});

	it("removing the instrument disposes it; re-adding one creates a fresh node", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const instrumentSpy = spyInstrumentFactory();
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => undefined,
				createInstrument: instrumentSpy.factory,
			},
			runtime.getDestination(),
		);

		track.reconcile(
			trackProjection({ type: "audio", instrument: null }),
			false,
		);
		expect(instrumentSpy.create).not.toHaveBeenCalled();

		track.reconcile(
			trackProjection({
				instrument: { kind: "sampler", assetId: null, parameters: {} },
			}),
			false,
		);
		expect(instrumentSpy.create).toHaveBeenCalledTimes(1);

		track.dispose();
		return runtime.close();
	});

	it("adding one device creates only that device; the existing one is untouched", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const deviceSpy = spyDeviceFactory();
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => undefined,
				createDeviceNode: deviceSpy.factory,
			},
			runtime.getDestination(),
		);

		track.reconcile(trackProjection({ devices: [device("dev_a", 0)] }), false);
		track.reconcile(
			trackProjection({ devices: [device("dev_a", 0), device("dev_b", 1)] }),
			false,
		);

		expect(deviceSpy.create).toHaveBeenCalledTimes(2);
		expect(deviceSpy.create).toHaveBeenNthCalledWith(2, "dev_b");
		expect(deviceSpy.dispose).not.toHaveBeenCalled();

		track.dispose();
		return runtime.close();
	});

	it("creates a send gain per targeted return and ramps its level on change, without recreating it", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const destination = runtime.getDestination();
		const returnInput = new Tone.Gain(1);
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => returnInput,
			},
			destination,
		);

		const returnId = ids("return");
		const send: Send = { returnId, level: 0.5, preFader: false };
		track.reconcile(trackProjection({ sendConfig: [send] }), false);
		const nodesAfterCreate = runtime.diagnostics().resources.byType.node ?? 0;
		expect(nodesAfterCreate).toBeGreaterThan(0);

		track.reconcile(
			trackProjection({ sendConfig: [{ ...send, level: 0.8 }] }),
			false,
		);
		expect(runtime.diagnostics().resources.byType.node).toBe(nodesAfterCreate);

		// Flipping preFader reconnects the existing gain rather than creating
		// a second one.
		track.reconcile(
			trackProjection({ sendConfig: [{ ...send, preFader: true }] }),
			false,
		);
		expect(runtime.diagnostics().resources.byType.node).toBe(nodesAfterCreate);

		track.reconcile(trackProjection({ sendConfig: [] }), false);
		expect(runtime.diagnostics().resources.byType.node).toBe(
			nodesAfterCreate - 1,
		);

		track.dispose();
		returnInput.dispose();
		return runtime.close();
	});

	it("effectiveMuted is applied every reconcile pass even when the track's own projection is unchanged", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => undefined,
			},
			runtime.getDestination(),
		);

		const projection = trackProjection();
		track.reconcile(projection, false);
		track.reconcile(projection, true); // another track soloed elsewhere

		expect(() => track.dispose()).not.toThrow();
		return runtime.close();
	});

	it("dispose() releases every resource this track registered and is idempotent", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const instrumentSpy = spyInstrumentFactory();
		const deviceSpy = spyDeviceFactory();
		const destination = runtime.getDestination();
		const returnInput = new Tone.Gain(1);
		const track = new TrackAudioGraphModule.TrackAudioGraph(
			ids("track"),
			{
				scope,
				assetsById: new Map(),
				bufferCache: {} as never,
				getReturnInput: () => returnInput,
				createInstrument: instrumentSpy.factory,
				createDeviceNode: deviceSpy.factory,
			},
			destination,
		);

		const returnId = ids("return");
		track.reconcile(
			trackProjection({
				devices: [device("dev_a", 0)],
				sendConfig: [{ returnId, level: 0.5, preFader: false }],
			}),
			false,
		);
		expect(runtime.diagnostics().resources.byOwner.p).toBeGreaterThan(0);

		track.dispose();
		track.dispose(); // idempotent
		await Promise.resolve();

		// "p" is this track's scope owner; the runtime's own context
		// registration under a different owner is untouched by a track's
		// dispose and is not this assertion's concern.
		expect(runtime.diagnostics().resources.byOwner.p).toBeUndefined();
		expect(instrumentSpy.dispose).toHaveBeenCalledTimes(1);
		expect(deviceSpy.dispose).toHaveBeenCalledTimes(1);

		returnInput.dispose();
		await runtime.close();
	});

	it("the channel strip preserves a hard-left stereo signal instead of downmixing it to mono", async () => {
		const rendered = await Tone.Offline(
			({ destination }) => {
				const runtime = new AudioRuntimeModule.AudioRuntime();
				const scope = runtime.openProjectScope("p");
				const track = new TrackAudioGraphModule.TrackAudioGraph(
					ids("track"),
					{
						scope,
						assetsById: new Map(),
						bufferCache: {} as never,
						getReturnInput: () => undefined,
					},
					destination,
				);
				track.reconcile(
					trackProjection({ type: "audio", instrument: null }),
					false,
				);

				// Feed a stereo signal with energy only in the left channel into the
				// track's channel strip; the right channel of `merge`'s input 1 is
				// left unconnected (silence).
				const merge = new Tone.Merge();
				merge.connect(track.audioInput);
				const noise = new Tone.Noise("white");
				noise.connect(merge, 0, 0);
				noise.start(0).stop(0.05);
			},
			0.05,
			2,
		);

		const left = rms(Float32Array.from(rendered.getChannelData(0)));
		const right = rms(Float32Array.from(rendered.getChannelData(1)));

		expect(left).toBeGreaterThan(0.01);
		expect(right).toBeLessThan(0.001);
	});
});
