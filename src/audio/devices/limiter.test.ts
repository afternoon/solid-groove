import { beforeAll, describe, expect, it } from "vitest";
import { createDevice, defaultDeviceParameters } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { installWebAudioGlobals, rmsWindow } from "../testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let deviceNode: typeof import("./deviceNode");
let limiter: typeof import("./limiter");

beforeAll(async () => {
  Tone = await import("tone");
  deviceNode = await import("./deviceNode");
  limiter = await import("./limiter");
});

const context = { scope: null as never, tempo: () => 120 };

function device(overrides: Record<string, number> = {}, bypassed = false): Device {
  return {
    ...createDevice("dev_lim" as DeviceId, "limiter", 0),
    bypassed,
    parameters: { ...defaultDeviceParameters("limiter"), ...overrides },
  };
}

/** A 220 Hz sine at `amplitude` through `d`, rendered offline. */
async function render(d: Device, amplitude: number): Promise<Float32Array> {
  const buffer = await Tone.Offline(() => {
    const node = deviceNode.buildDeviceNode(d, context, limiter.createLimiterCore);
    const osc = new Tone.Oscillator({ type: "sine", frequency: 220 });
    const gain = new Tone.Gain(amplitude);
    osc.chain(gain, node.input);
    node.output.toDestination();
    osc.start(0);
  }, 0.5);
  return buffer.getChannelData(0);
}

function peak(data: Float32Array): number {
  let max = 0;
  for (const sample of data) max = Math.max(max, Math.abs(sample));
  return max;
}

const dbToGain = (db: number) => 10 ** (db / 20);

describe("limiter (#937)", () => {
  it("never lets a peak out above the ceiling, however hard it is driven", async () => {
    for (const ceiling of [-0.3, -6]) {
      // +12 dB over full scale, then 12 dB of drive on top.
      const output = await render(device({ ceiling, drive: 12 }), 4);
      expect(peak(output), `ceiling ${ceiling}`).toBeLessThanOrEqual(
        dbToGain(ceiling) + 1e-6,
      );
      // And it is limiting, not muting: the level sits up at the ceiling.
      expect(rmsWindow(output, 0.2, 0.45)).toBeGreaterThan(dbToGain(ceiling) * 0.6);
    }
  });

  it("passes material under the ceiling at its own level", async () => {
    const output = await render(device(), 0.25);
    // A sine's RMS is its amplitude over root two; the node's automatic makeup
    // is cancelled, so nothing is added.
    expect(rmsWindow(output, 0.2, 0.45)).toBeCloseTo(0.25 / Math.SQRT2, 2);
  });

  it("adds Drive as clean gain below the ceiling", async () => {
    const output = await render(device({ drive: 6 }), 0.1);
    expect(rmsWindow(output, 0.2, 0.45)).toBeCloseTo((0.1 * dbToGain(6)) / Math.SQRT2, 2);
  });

  it("lets everything through untouched when bypassed", async () => {
    const output = await render(device({ ceiling: -6, drive: 12 }, true), 0.9);
    expect(peak(output)).toBeGreaterThan(0.85);
  });
});
