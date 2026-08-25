import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Device } from "../domain/entities";
import { createManualScheduler } from "../shared/scheduler";
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

    chain.reconcile([device("dev_a", 0), device("dev_b", 1), device("dev_c", 2)]);
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
    const scheduler = createManualScheduler();
    const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]), scheduler);

    chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
    // A reorder relinks: the output gain must be scheduled down to 0, and
    // (once the down-ramp has actually reached silence) back to 1 — a
    // make-before-break fade — rather than switching topology at full
    // gain, which is the audible transient FX-01 forbids.
    const rampsScheduled: number[] = [];
    const gain = chain.output.gain;
    const originalRamp = gain.linearRampToValueAtTime.bind(gain);
    gain.linearRampToValueAtTime = ((value: number, time: number) => {
      rampsScheduled.push(value);
      return originalRamp(value, time);
    }) as typeof gain.linearRampToValueAtTime;

    chain.reconcile([device("dev_b", 0), device("dev_a", 1)]);
    expect(rampsScheduled).toEqual([0]);

    scheduler.advance(DeviceChainModule.RELINK_FADE_SECONDS * 1000);
    expect(rampsScheduled).toEqual([0, 1]);

    chain.dispose();
    return runtime.close();
  });

  it("defers the topology rewire until the down-ramp has reached silence (true make-before-break)", () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const scope = runtime.openProjectScope("p");
    const scheduler = createManualScheduler();
    const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]), scheduler);

    // First reconcile is the initial build — no prior topology, so it
    // links immediately with no fade (see the initial-build guard test).
    chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);

    const events: string[] = [];
    const originalDisconnect = chain.input.disconnect.bind(chain.input);
    chain.input.disconnect = (() => {
      events.push("rewire");
      return originalDisconnect();
    }) as typeof chain.input.disconnect;
    const gain = chain.output.gain;
    const originalRamp = gain.linearRampToValueAtTime.bind(gain);
    gain.linearRampToValueAtTime = ((value: number, time: number) => {
      events.push(value === 0 ? "ramp-down" : "ramp-up");
      return originalRamp(value, time);
    }) as typeof gain.linearRampToValueAtTime;

    // A reorder is a genuine relink: the down-ramp must be scheduled, but
    // the rewire (input.disconnect(), the FX-01 bug's synchronous half)
    // must NOT run yet — the previous topology is still live and
    // connected, and the down-ramp is only a future automation curve at
    // this point, not yet a value of 0.
    chain.reconcile([device("dev_b", 0), device("dev_a", 1)]);
    expect(events).toEqual(["ramp-down"]);
    expect(scheduler.pending).toBe(1);

    // Only once the scheduler fires — i.e. once the down-ramp has actually
    // reached 0 — does the rewire run, immediately followed by the ramp
    // back up. This ordering (rewire strictly after ramp-down) is exactly
    // what the pre-fix synchronous code got backwards.
    scheduler.advance(DeviceChainModule.RELINK_FADE_SECONDS * 1000);
    expect(events).toEqual(["ramp-down", "rewire", "ramp-up"]);

    chain.dispose();
    return runtime.close();
  });

  it("the initial build links directly with no fade or deferred rewire", () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const scope = runtime.openProjectScope("p");
    const scheduler = createManualScheduler();
    const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]), scheduler);

    const gain = chain.output.gain;
    let ramps = 0;
    const originalRamp = gain.linearRampToValueAtTime.bind(gain);
    gain.linearRampToValueAtTime = ((value: number, time: number) => {
      ramps += 1;
      return originalRamp(value, time);
    }) as typeof gain.linearRampToValueAtTime;

    // The very first reconcile builds topology from empty — there is no
    // prior live routing to click away from, so it must not schedule any
    // fade (which would just be an audible dip/fade-in on project open).
    chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);

    expect(ramps).toBe(0);
    expect(scheduler.pending).toBe(0);

    chain.dispose();
    return runtime.close();
  });

  it("coalesces a relink that arrives mid-fade into exactly one consistent wiring and one gain recovery", () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const scope = runtime.openProjectScope("p");
    const scheduler = createManualScheduler();
    const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]), scheduler);

    chain.reconcile([device("dev_a", 0), device("dev_b", 1), device("dev_c", 2)]);

    let disconnectCalls = 0;
    const originalDisconnect = chain.input.disconnect.bind(chain.input);
    chain.input.disconnect = (() => {
      disconnectCalls += 1;
      return originalDisconnect();
    }) as typeof chain.input.disconnect;
    const gain = chain.output.gain;
    let rampUps = 0;
    const originalRamp = gain.linearRampToValueAtTime.bind(gain);
    gain.linearRampToValueAtTime = ((value: number, time: number) => {
      if (value === 1) rampUps += 1;
      return originalRamp(value, time);
    }) as typeof gain.linearRampToValueAtTime;

    // First relink starts fading out...
    chain.reconcile([device("dev_b", 0), device("dev_a", 1), device("dev_c", 2)]);
    expect(scheduler.pending).toBe(1);

    // ...but a second relink arrives before the first's deferred rewire
    // fires. The first's pending rewire must be superseded, not run.
    chain.reconcile([device("dev_c", 0), device("dev_a", 1), device("dev_b", 2)]);
    expect(scheduler.pending).toBe(1); // still exactly one pending rewire
    expect(disconnectCalls).toBe(0); // neither has rewired yet

    scheduler.runAll();

    // Exactly one rewire ran (the superseded one never fired), and the
    // gain recovered to 1 exactly once — never stuck at 0, never double.
    expect(disconnectCalls).toBe(1);
    expect(rampUps).toBe(1);
    expect(scheduler.pending).toBe(0);

    chain.dispose();
    return runtime.close();
  });

  it("dispose() cancels a pending scheduled rewire so it can never fire after teardown", async () => {
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const scope = runtime.openProjectScope("p");
    const scheduler = createManualScheduler();
    const chain = new DeviceChainModule.DeviceChain(scope, fakeFactory([]), scheduler);

    chain.reconcile([device("dev_a", 0), device("dev_b", 1)]);
    chain.reconcile([device("dev_b", 0), device("dev_a", 1)]);
    expect(scheduler.pending).toBe(1);

    chain.dispose();

    // Advancing the scheduler afterward must not throw or touch disposed
    // nodes — the pending rewire was cancelled by dispose().
    expect(() =>
      scheduler.advance(DeviceChainModule.RELINK_FADE_SECONDS * 1000),
    ).not.toThrow();
    expect(scheduler.pending).toBe(0);

    await runtime.close();
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
    chain.reconcile([{ ...device("dev_a", 0), bypassed: true }, device("dev_b", 1)]);
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

    expect(rms(Float32Array.from(rendered.getChannelData(0)))).toBeGreaterThan(0.01);
  });
});
