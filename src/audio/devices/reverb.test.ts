import { beforeAll, describe, expect, it, vi } from "vitest";
import { createDevice, defaultDeviceParameters } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { hfEnergy, installWebAudioGlobals, rms, rmsWindow } from "../testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let deviceNode: typeof import("./deviceNode");
let reverb: typeof import("./reverb");

beforeAll(async () => {
  Tone = await import("tone");
  deviceNode = await import("./deviceNode");
  reverb = await import("./reverb");
});

// The reverb reads no tempo; the context is here only to satisfy the factory.
const context = { scope: null as never, tempo: () => 120 };

function device(overrides: Record<string, number> = {}): Device {
  return {
    ...createDevice("dev_reverb" as DeviceId, "reverb", 0),
    parameters: { ...defaultDeviceParameters("reverb"), ...overrides },
  };
}

/**
 * Renders a short burst — a sine that stops a quarter of the way in — through
 * one device, so what happens *after* the source stops is measurable. That is
 * the only way to assert on a tail or a repeat: with a continuous source the
 * wet signal is indistinguishable from the dry one.
 */
async function renderBurst(
  create: import("./types").DeviceCoreFactory,
  d: Device,
  duration: number,
  options: { source?: "sine" | "noise" } = {},
): Promise<Float32Array> {
  const buffer = await Tone.Offline(async () => {
    const node = deviceNode.buildDeviceNode(d, context, create);
    // The reverb builds its impulse response off the audio thread, so a
    // render started before it lands has no tail at all. `Tone.Offline`
    // awaits an async callback before rendering, which is exactly the hook
    // this needs.
    await node.ready?.();
    // White noise is the probe for anything measuring a *filter*: it has
    // energy at every frequency, so removing the top of the band shows up
    // unambiguously. A 220 Hz sine (the probe used elsewhere here) has almost
    // nothing above 400 Hz to begin with, so a lowpass sweeping between 400 Hz
    // and 18 kHz leaves its `hfEnergy`-per-level *identical* — which is what
    // made the first version of the reverb damping test measure nothing.
    const source =
      options.source === "noise"
        ? new Tone.Noise("white")
        : new Tone.Oscillator({ type: "sine", frequency: 220 });
    source.connect(node.input);
    node.output.toDestination();
    source.start(0).stop(duration * 0.25);
  }, duration);
  return buffer.getChannelData(0);
}

describe("reverb (FX-01)", () => {
  it("rings on after the source stops, and longer with a longer decay", async () => {
    // Noise rather than a sine: `Tone.Reverb` builds each impulse response
    // from unseeded noise, and a broadband source excites the whole impulse
    // so the measured tail reflects the decay setting rather than however
    // this particular impulse happened to land near 220 Hz. Averaging a few
    // renders removes what variance is left.
    async function meanTail(decay: number): Promise<number> {
      let total = 0;
      for (let i = 0; i < 3; i++) {
        const data = await renderBurst(
          reverb.createReverbCore,
          device({ decay, size: 0.5, wet: 1 }),
          2,
          { source: "noise" },
        );
        // The source stops a quarter of the way in; this window is tail only.
        total += rmsWindow(data, 0.6, 0.9);
      }
      return total / 3;
    }
    expect(await meanTail(4)).toBeGreaterThan((await meanTail(0.3)) * 2);
  });

  it("damps the tail with its filter", async () => {
    // Measured with a *noise* burst: see `renderBurst` for why a sine cannot
    // detect this filter at all.
    async function brightness(cutoff: number): Promise<number> {
      const data = await renderBurst(
        reverb.createReverbCore,
        device({ decay: 2, filter: cutoff, wet: 1 }),
        1,
        { source: "noise" },
      );
      // Normalised by level, so this compares tone rather than loudness —
      // a 400 Hz lowpass drops the total level too.
      return hfEnergy(data) / Math.max(1e-9, rms(data));
    }
    // The gap here is roughly 18x, far larger than the run-to-run spread from
    // `Tone.Reverb` building each impulse response from unseeded noise, so a
    // wide margin keeps this deterministic rather than pinning one impulse.
    expect(await brightness(400)).toBeLessThan((await brightness(18_000)) / 4);
  });

  it("regenerates its impulse once per change, only when decay, size, or pre-delay changed", async () => {
    const core = reverb.createReverbCore(device(), context);
    const node = core.input as unknown as import("tone").Reverb;
    const generate = vi.spyOn(node, "generate");
    const rebuilds = async () => {
      await core.ready?.();
      return generate.mock.calls.length;
    };

    const values = { ...defaultDeviceParameters("reverb") };
    // The first apply sets both values, then regenerates once.
    core.apply(values, context, true);
    expect(await rebuilds()).toBe(1);

    core.apply(values, context, false);
    expect(await rebuilds()).toBe(1); // identical values: nothing to rebuild

    core.apply({ ...values, filter: 1_000 }, context, false);
    // A filter-only edit is a ramp on the damping node. Regenerating here
    // would restart a ringing tail from a fresh impulse for no reason.
    expect(await rebuilds()).toBe(1);

    core.apply({ ...values, decay: 6 }, context, false);
    expect(await rebuilds()).toBe(2);
    core.apply({ ...values, decay: 6, size: 0.9 }, context, false);
    expect(await rebuilds()).toBe(3);

    core.dispose();
  });

  it("ends on the impulse for the latest values, never a slower stale one", async () => {
    // Tone starts a generation per setter, and the constructor's long default
    // impulse used to land *after* the short one asked for, replacing it.
    const core = reverb.createReverbCore(device(), context);
    const values = {
      ...defaultDeviceParameters("reverb"),
      decay: 1,
      size: 0,
      predelay: 0,
    };
    core.apply(values, context, true);
    await core.ready?.();
    // Every generation Tone could still have in flight has had time to land.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const convolver = (core.input as unknown as { _convolver: { buffer: AudioBuffer } })
      ._convolver;
    expect(convolver.buffer.duration).toBeCloseTo(0.5, 2);
    core.dispose();
  });

  it("stays finite at the longest decay it allows (FX-02)", async () => {
    const data = await renderBurst(
      reverb.createReverbCore,
      device({ decay: 30, size: 1, wet: 1 }),
      1,
    );
    expect(data.every((s) => Number.isFinite(s))).toBe(true);
  });
});
