import { beforeAll, describe, expect, it } from "vitest";
import { createDevice, defaultDeviceParameters } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { installWebAudioGlobals, rms, rmsWindow } from "../testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let deviceNode: typeof import("./deviceNode");
let compressor: typeof import("./compressor");

beforeAll(async () => {
  Tone = await import("tone");
  deviceNode = await import("./deviceNode");
  compressor = await import("./compressor");
});

const context = { scope: null as never, tempo: () => 120 };

function device(overrides: Record<string, number> = {}): Device {
  return {
    ...createDevice("dev_comp" as DeviceId, "compressor", 0),
    parameters: { ...defaultDeviceParameters("compressor"), ...overrides },
  };
}

/**
 * Renders a sine that steps from quiet to loud halfway through, so the
 * compressor has something to actually clamp down on and the two halves can be
 * compared against each other within one render.
 */
async function renderStep(d: Device): Promise<Float32Array> {
  const buffer = await Tone.Offline(() => {
    const node = deviceNode.buildDeviceNode(d, context, compressor.createCompressorCore);
    const osc = new Tone.Oscillator({ type: "sine", frequency: 220 });
    const gain = new Tone.Gain(0.05);
    osc.connect(gain);
    gain.connect(node.input);
    node.output.toDestination();
    osc.start(0);
    gain.gain.setValueAtTime(0.05, 0);
    gain.gain.setValueAtTime(1, 0.5);
  }, 1);
  return buffer.getChannelData(0);
}

describe("compressor (FX-01)", () => {
  it("narrows a 20x input step toward the threshold", async () => {
    const compressed = await renderStep(
      device({
        threshold: -30,
        ratio: 20,
        attack: 0.001,
        release: 0.05,
        makeup: 0,
      }),
    );
    // Everything is measured *inside one render*, against the input step this
    // test itself creates (0.05 -> 1, a factor of 20). Comparing two separate
    // renders is what made an earlier version of this flaky: each offline
    // render builds its graph against the shared global context, so the two
    // were not reliably independent.
    const quiet = rmsWindow(compressed, 0.2, 0.45);
    const loud = rmsWindow(compressed, 0.75, 0.95);
    // The quiet half is under the threshold and passes through, so the output
    // step must be materially smaller than the 20x input step.
    expect(loud / quiet).toBeGreaterThan(1);
    expect(loud / quiet).toBeLessThan(10);
  });

  it("compresses harder at a higher ratio", async () => {
    // Same within-render measurement, so the two settings are compared by how
    // much each narrows its own step rather than across renders.
    async function stepGrowth(ratio: number): Promise<number> {
      const data = await renderStep(device({ threshold: -30, ratio }));
      return rmsWindow(data, 0.75, 0.95) / rmsWindow(data, 0.2, 0.45);
    }
    expect(await stepGrowth(20)).toBeLessThan(await stepGrowth(2));
  });

  it("applies makeup gain on top of the compressed signal", async () => {
    const flat = await renderStep(device({ threshold: -30, ratio: 8 }));
    const loud = await renderStep(device({ threshold: -30, ratio: 8, makeup: 12 }));
    expect(rms(loud) / rms(flat)).toBeGreaterThan(3);
  });

  it("exposes a gain-reduction read for metering", () => {
    const node = deviceNode.buildDeviceNode(
      device({ threshold: -40, ratio: 20 }),
      context,
      compressor.createCompressorCore,
    );
    // The wrapper forwards the core's meter, so a panel can poll one number
    // per frame without the device pushing any telemetry of its own (FX-01
    // gain-reduction metering).
    expect(typeof node.gainReductionDb?.()).toBe("number");
    // Reported as a positive magnitude, which is how a meter reads — the
    // underlying node's `reduction` is negative or zero.
    expect(node.gainReductionDb?.()).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(node.gainReductionDb?.() ?? Number.NaN)).toBe(true);
    node.dispose();
  });

  it("accepts every extreme of its registered ranges without throwing", () => {
    const node = deviceNode.buildDeviceNode(
      device(),
      context,
      compressor.createCompressorCore,
    );
    // A threshold of 0 dB and a ratio of 1 are the top of their ranges and
    // both are legitimate "do not compress" settings; a threshold of -60 with
    // a 20:1 ratio is the destructive end. Neither may throw.
    expect(() =>
      node.update(device({ threshold: 0, ratio: 1, makeup: 0 })),
    ).not.toThrow();
    expect(() =>
      node.update(
        device({
          threshold: -60,
          ratio: 20,
          attack: 0,
          release: 2,
          makeup: 24,
        }),
      ),
    ).not.toThrow();
    node.dispose();
  });

  it("disposes idempotently", () => {
    const node = deviceNode.buildDeviceNode(
      device(),
      context,
      compressor.createCompressorCore,
    );
    node.dispose();
    expect(() => node.dispose()).not.toThrow();
  });
});
