import { beforeAll, describe, expect, it } from "vitest";
import { createDevice, defaultDeviceParameters } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { hfEnergy, installWebAudioGlobals, rms, rmsWindow } from "../testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let deviceNode: typeof import("./deviceNode");
let delay: typeof import("./delay");

beforeAll(async () => {
  Tone = await import("tone");
  deviceNode = await import("./deviceNode");
  delay = await import("./delay");
});

function context(tempo = 120) {
  return { scope: null as never, tempo: () => tempo };
}

function device(
  type: Parameters<typeof createDevice>[1],
  overrides: Record<string, number> = {},
): Device {
  return {
    ...createDevice("dev_time" as DeviceId, type, 0),
    parameters: { ...defaultDeviceParameters(type), ...overrides },
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
  options: { source?: "sine" | "noise"; tempo?: number } = {},
): Promise<Float32Array> {
  const buffer = await Tone.Offline(() => {
    const node = deviceNode.buildDeviceNode(d, context(options.tempo ?? 120), create);
    // White noise is the probe for anything measuring a *filter*: it has
    // energy at every frequency, so removing the top of the band shows up
    // unambiguously. A 220 Hz sine (the probe used elsewhere here) has almost
    // nothing above 400 Hz to begin with, so a lowpass sweeping between 400 Hz
    // and 18 kHz leaves its `hfEnergy`-per-level *identical* — which is what
    // made the first version of the delay damping test measure nothing.
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

describe("delay (FX-01)", () => {
  it("derives a synced time from the song tempo and ignores the free time", () => {
    const values = {
      ...defaultDeviceParameters("delay"),
      sync: 1,
      division: 5,
    };
    // Division 5 is a 1/4 note: one beat, so 0.5 s at 120 BPM and 1 s at 60.
    expect(delay.delaySeconds(values, 120)).toBeCloseTo(0.5, 5);
    expect(delay.delaySeconds(values, 60)).toBeCloseTo(1, 5);
    // Changing the free time changes nothing while synced.
    expect(delay.delaySeconds({ ...values, time: 0.001 }, 120)).toBeCloseTo(0.5, 5);
  });

  it("uses the free time verbatim and ignores tempo when sync is off", () => {
    const values = {
      ...defaultDeviceParameters("delay"),
      sync: 0,
      time: 0.375,
    };
    expect(delay.delaySeconds(values, 120)).toBeCloseTo(0.375, 5);
    expect(delay.delaySeconds(values, 200)).toBeCloseTo(0.375, 5);
  });

  it("bounds the delay line however slow the tempo or hostile the value", () => {
    const synced = {
      ...defaultDeviceParameters("delay"),
      sync: 1,
      division: 6,
    };
    // A half note at an absurdly slow tempo would want far more than the
    // allocated line; it is clamped rather than allocating without limit.
    expect(delay.delaySeconds(synced, 1)).toBeLessThanOrEqual(4);
    // A non-finite tempo falls back rather than producing NaN, which would
    // poison the delay's `AudioParam` permanently.
    expect(Number.isFinite(delay.delaySeconds(synced, Number.NaN))).toBe(true);
  });

  it("produces audible repeats after the source stops", async () => {
    const data = await renderBurst(
      delay.createDelayCore,
      device("delay", { sync: 0, time: 0.1, feedback: 0.7, wet: 1 }),
      1,
    );
    // The source stops at 0.25 s; energy well after that is the repeats.
    expect(rmsWindow(data, 0.45, 0.7)).toBeGreaterThan(0.001);
  });

  it("darkens each successive repeat through the feedback damping filter", async () => {
    const data = await renderBurst(
      delay.createDelayCore,
      device("delay", {
        sync: 0,
        time: 0.1,
        feedback: 0.8,
        filter: 600,
        wet: 1,
      }),
      1.5,
      // Noise, so there is high-frequency content for the loop filter to
      // remove repeat by repeat — see `renderBurst`.
      { source: "noise" },
    );
    const early = data.subarray(
      Math.floor(data.length * 0.3),
      Math.floor(data.length * 0.45),
    );
    const late = data.subarray(
      Math.floor(data.length * 0.7),
      Math.floor(data.length * 0.85),
    );
    // Per unit of level, later repeats carry less high-frequency content —
    // which is what stops a near-unity feedback from being a bright runaway.
    expect(hfEnergy(late) / Math.max(1e-9, rms(late))).toBeLessThan(
      hfEnergy(early) / Math.max(1e-9, rms(early)),
    );
  });

  it("stays finite and bounded at the top of its feedback range (FX-02)", async () => {
    const data = await renderBurst(
      delay.createDelayCore,
      device("delay", { sync: 0, time: 0.05, feedback: 0.99, wet: 1 }),
      2,
    );
    expect(data.every((s) => Number.isFinite(s))).toBe(true);
    // The saturator inside the feedback loop bounds what can circulate to
    // ±1, so the device's own output stays near unity plus the dry signal.
    // Without it this measured ~16 — fresh input keeps summing into the loop
    // while the source plays, so a sub-unity feedback gain alone does *not*
    // bound the result (FX-02: validation prevents unsafe output levels).
    expect(Math.max(...data.map(Math.abs))).toBeLessThan(2.5);
  });

  it("widens the two channels with spread", async () => {
    async function channelDifference(spread: number): Promise<number> {
      const buffer = await Tone.Offline(() => {
        const node = deviceNode.buildDeviceNode(
          device("delay", {
            sync: 0,
            time: 0.1,
            feedback: 0.5,
            spread,
            wet: 1,
          }),
          context(),
          delay.createDelayCore,
        );
        const osc = new Tone.Oscillator({ type: "sine", frequency: 220 });
        osc.connect(node.input);
        node.output.toDestination();
        osc.start(0).stop(0.2);
      }, 1);
      const l = buffer.getChannelData(0);
      const r = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0);
      let sum = 0;
      for (let i = 0; i < l.length; i++) sum += (l[i] - r[i]) ** 2;
      return Math.sqrt(sum / l.length);
    }
    expect(await channelDifference(1)).toBeGreaterThan(await channelDifference(0));
  });

  it("disposes without stranding its feedback loop", () => {
    const node = deviceNode.buildDeviceNode(
      device("delay"),
      context(),
      delay.createDelayCore,
    );
    node.dispose();
    expect(() => node.dispose()).not.toThrow();
  });
});
