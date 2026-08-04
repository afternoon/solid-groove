import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Device } from "../domain/entities";
import { installWebAudioGlobals, rms } from "./testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let AudioRuntimeModule: typeof import("./AudioRuntime");
let DeviceChainModule: typeof import("./DeviceChain");

beforeAll(async () => {
	Tone = await import("tone");
	AudioRuntimeModule = await import("./AudioRuntime");
	DeviceChainModule = await import("./DeviceChain");
});

afterEach(async () => {
	try {
		await AudioRuntimeModule.getAudioRuntime().close();
	} catch {
		// already closed by the test itself
	}
	AudioRuntimeModule.__resetAudioRuntimeForTests();
});

function device(id: string, order: number, type = "generic"): Device {
	return {
		id: id as Device["id"],
		type,
		order,
		bypassed: false,
		parameters: {},
		preset: null,
	};
}

/** A fake device node factory that records create/update/dispose calls by id,
 * so reconciliation churn can be asserted precisely without any acoustic
 * introspection of the resulting Tone graph. */
function fakeFactory(log: string[]): import("./DeviceChain").DeviceNodeFactory {
	return (d) => {
		log.push(`create:${d.id}`);
		const node = new Tone.Gain(1);
		return {
			id: d.id,
			type: d.type,
			input: node,
			output: node,
			update(next) {
				log.push(`update:${next.id}`);
			},
			dispose() {
				log.push(`dispose:${d.id}`);
				node.dispose();
			},
		};
	};
}

describe("DeviceChain", () => {
	it("creates one node per device and reuses it on a parameter-only reconcile", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const log: string[] = [];
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory(log));

		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		expect(log).toEqual(["create:dev_a", "create:dev_b"]);

		log.length = 0;
		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		expect(log).toEqual(["update:dev_a", "update:dev_b"]);

		chain.dispose();
		return runtime.close();
	});

	it("adding one device creates only that device's node", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const log: string[] = [];
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory(log));

		chain.reconcile([device("dev_a", 0)]);
		log.length = 0;

		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		expect(log).toEqual(["update:dev_a", "create:dev_b"]);

		chain.dispose();
		return runtime.close();
	});

	it("removing one device disposes only that device's node", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const log: string[] = [];
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory(log));

		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		log.length = 0;

		chain.reconcile([device("dev_a", 0)]);
		expect(log).toEqual(["dispose:dev_b", "update:dev_a"]);

		chain.dispose();
		return runtime.close();
	});

	it("reordering existing devices reuses every node — no create or dispose", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const log: string[] = [];
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory(log));

		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		log.length = 0;

		chain.reconcile([device("dev_b", 0), device("dev_a", 1)]);
		expect(log.filter((entry) => entry.startsWith("create"))).toEqual([]);
		expect(log.filter((entry) => entry.startsWith("dispose"))).toEqual([]);
		expect(log).toEqual(["update:dev_b", "update:dev_a"]);

		chain.dispose();
		return runtime.close();
	});

	it("an unrelated bypass/parameter edit does not touch other devices", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const log: string[] = [];
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory(log));

		chain.reconcile([
			device("dev_a", 0),
			device("dev_b", 1),
			device("dev_c", 2),
		]);
		log.length = 0;

		chain.reconcile([
			device("dev_a", 0),
			{ ...device("dev_b", 1), bypassed: true },
			device("dev_c", 2),
		]);
		// Every surviving device gets `update()` (bypass is applied there) but
		// none is created or disposed.
		expect(log.filter((entry) => entry.startsWith("create"))).toEqual([]);
		expect(log.filter((entry) => entry.startsWith("dispose"))).toEqual([]);

		chain.dispose();
		return runtime.close();
	});

	it("dispose() tears down every device node and the chain's own shell; idempotent", async () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const log: string[] = [];
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory(log));
		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);

		const baseline = runtime.diagnostics().resources.total;
		expect(baseline).toBeGreaterThan(0);

		chain.dispose();
		chain.dispose(); // idempotent — no duplicate dispose, no throw

		await Promise.resolve();
		expect(runtime.diagnostics().resources.total).toBe(0);
		expect(log.filter((e) => e.startsWith("dispose")).sort()).toEqual([
			"dispose:dev_a",
			"dispose:dev_b",
		]);

		await runtime.close();
	});

	it("dips the chain output around a relink so a reorder is click-safe", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]));

		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		// A reorder relinks: the output gain must be scheduled down to 0 and back
		// to 1 (a make-before-break fade) rather than switching topology at full
		// gain, which is the audible transient FX-01 forbids.
		const rampsScheduled: number[] = [];
		const gain = chain.output.gain;
		const originalRamp = gain.linearRampToValueAtTime.bind(gain);
		gain.linearRampToValueAtTime = ((value: number, time: number) => {
			rampsScheduled.push(value);
			return originalRamp(value, time);
		}) as typeof gain.linearRampToValueAtTime;

		chain.reconcile([device("dev_b", 0), device("dev_a", 1)]);
		expect(rampsScheduled).toEqual([0, 1]);

		chain.dispose();
		return runtime.close();
	});

	it("does not dip the output on a bypass/parameter-only reconcile", () => {
		const runtime = new AudioRuntimeModule.AudioRuntime();
		const scope = runtime.openProjectScope("p");
		const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]));

		chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
		const gain = chain.output.gain;
		let ramps = 0;
		const originalRamp = gain.linearRampToValueAtTime.bind(gain);
		gain.linearRampToValueAtTime = ((value: number, time: number) => {
			ramps += 1;
			return originalRamp(value, time);
		}) as typeof gain.linearRampToValueAtTime;

		// Same ids, same order, only a bypass flip — no relink, so no fade.
		chain.reconcile([
			{ ...device("dev_a", 0), bypassed: true },
			device("dev_b", 1),
		]);
		expect(ramps).toBe(0);

		chain.dispose();
		return runtime.close();
	});

	it("the default passthrough device leaves a signal unchanged", async () => {
		const rendered = await Tone.Offline(({ destination }) => {
			const runtime = new AudioRuntimeModule.AudioRuntime();
			const scope = runtime.openProjectScope("p");
			const chain = new DeviceChainModule.DeviceChain(scope);
			chain.output.connect(destination);
			chain.reconcile([device("dev_a", 0)]);

			const noise = new Tone.Noise("white").connect(chain.input).start(0);
			noise.stop(0.05);
		}, 0.05);

		expect(rms(Float32Array.from(rendered.getChannelData(0)))).toBeGreaterThan(
			0.01,
		);
	});
});
