import { beforeAll, describe, expect, it } from "vitest";
import { createDevice, defaultDeviceParameters } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { bestLag, noiseBurst } from "../../testing/latencyProbe";
import { installWebAudioGlobals } from "../testAudioContext";

/**
 * The Compressor's and the master limiter's declared latency, pinned against
 * what this engine actually renders (#883). Plugin delay compensation trusts
 * the declaration and never measures, so a wrong figure here would quietly
 * misalign every mix and every stem; this is where it fails instead.
 *
 * The same check runs in Chromium, Chrome, Edge and Firefox against the
 * browsers' declaration in `tests/e2e/emulator/deviceLatency.spec.ts`.
 */

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let devices: typeof import("./index");
let master: typeof import("../MasterAudioGraph");

beforeAll(async () => {
  Tone = await import("tone");
  devices = await import("./index");
  master = await import("../MasterAudioGraph");
});

const context = { scope: null as never, tempo: () => 120 };

function compressor(overrides: Record<string, number> = {}): Device {
  return {
    ...createDevice("dev_comp" as DeviceId, "compressor", 0),
    parameters: { ...defaultDeviceParameters("compressor"), ...overrides },
  };
}

function nodeFor(d: Device) {
  const node = devices.createDeviceNodeFactory(context)(d);
  if (!node) throw new Error("no compressor core");
  return node;
}

/** Far beyond any compressor's pre-delay, so a wrong figure cannot hide. */
const MAX_LAG = 2_048;

/**
 * Renders the same noise burst dry on the left and through `path` on the
 * right, and returns the lag between them.
 */
async function lagThrough(
  sampleRate: number,
  path: () => { input: import("tone").InputNode; output: import("tone").ToneAudioNode },
): Promise<number> {
  const burst = noiseBurst(Math.round(sampleRate * 0.1));
  const rendered = await Tone.Offline(
    () => {
      const merge = new Tone.Merge().toDestination();
      const player = new Tone.Player(Tone.ToneAudioBuffer.fromArray(burst));
      const { input, output } = path();
      player.connect(merge, 0, 0);
      player.connect(input);
      output.connect(merge, 0, 1);
      player.start(0);
    },
    0.25,
    2,
    sampleRate,
  );
  return bestLag(rendered.getChannelData(0), rendered.getChannelData(1), MAX_LAG);
}

describe("declared processing latency (#883)", () => {
  it.each([22_050, 44_100, 48_000])(
    "the Compressor delays its signal by exactly its declared latency at %d Hz",
    async (sampleRate) => {
      const declared = devices.deviceLatencyFrames("compressor", sampleRate);
      expect(declared).toBeGreaterThan(0);
      // At 1:1 it changes nothing but time: the case the issue measured.
      const unity = await lagThrough(sampleRate, () =>
        nodeFor(compressor({ ratio: 1, threshold: 0 })),
      );
      expect(unity).toBe(declared);
    },
  );

  it("does not move with its settings, wet/dry mix or bypass", async () => {
    const sampleRate = 48_000;
    const declared = devices.deviceLatencyFrames("compressor", sampleRate);
    const settings = [
      compressor({ threshold: -30, ratio: 8, attack: 0.001, release: 0.05 }),
      compressor({ threshold: -20, ratio: 4, wet: 0.5 }),
      { ...compressor({ threshold: -30, ratio: 8 }), bypassed: true },
    ];
    for (const settingsDevice of settings) {
      const lag = await lagThrough(sampleRate, () => nodeFor(settingsDevice));
      expect(lag).toBe(declared);
    }
  });

  it("the master safety limiter delays the mix by exactly its declared latency", async () => {
    const sampleRate = 44_100;
    const lag = await lagThrough(sampleRate, () => {
      const limiter = new Tone.Limiter(master.MASTER_LIMITER_THRESHOLD_DB);
      return { input: limiter, output: limiter };
    });
    expect(lag).toBe(master.masterLimiterLatencyFrames(sampleRate));
  });

  it("declares no latency for a device that looks ahead of nothing", () => {
    for (const type of devices.registeredDeviceCoreTypes()) {
      if (type === "compressor") continue;
      expect(devices.deviceLatencyFrames(type, 48_000), type).toBe(0);
    }
    expect(devices.deviceLatencyFrames("future-device", 48_000)).toBe(0);
    expect(devices.deviceLatencyFrames("toString", 48_000)).toBe(0);
  });
});
