import { beforeAll, describe, expect, it } from "vitest";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { installWebAudioGlobals, rms } from "../testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let deviceNode: typeof import("./deviceNode");
let types: typeof import("./types");

beforeAll(async () => {
  Tone = await import("tone");
  deviceNode = await import("./deviceNode");
  types = await import("./types");
});

const context = { scope: null as never, tempo: () => 120 };

/**
 * The simplest possible core: a fixed gain, so every assertion below is about
 * the shared wrapper and not any real device's DSP. `overdrive` is borrowed
 * only as a device *type* — its registered parameters include `wet` and
 * `output`.
 */
function halfGainCore(): import("./types").DeviceCore {
  const gain = new Tone.Gain(0.5);
  return {
    input: gain,
    output: gain,
    apply() {
      // Nothing of its own — the wrapper is what is under test.
    },
    dispose() {
      gain.dispose();
    },
  };
}

function device(parameters: Record<string, number>, bypassed = false): Device {
  return {
    id: "dev_wrapper" as DeviceId,
    type: "overdrive",
    order: 0,
    bypassed,
    parameters,
    preset: null,
  };
}

function build(d: Device) {
  return deviceNode.buildDeviceNode(d, context, halfGainCore);
}

/** Renders a steady sine through one wrapped device and returns the settled
 * second half of the mono channel, past the smoothing ramp at the head. */
async function render(d: Device): Promise<Float32Array> {
  const buffer = await Tone.Offline(() => {
    const node = build(d);
    const osc = new Tone.Oscillator({ type: "sine", frequency: 220 });
    osc.connect(node.input);
    node.output.toDestination();
    osc.start(0);
  }, 0.4);
  const data = buffer.getChannelData(0);
  return data.subarray(Math.floor(data.length / 2));
}

describe("readDeviceParameters", () => {
  it("fills in each definition's default for a key the sparse map omits", () => {
    const values = types.readDeviceParameters(
      [
        {
          id: "overdrive.drive",
          label: "Drive",
          unit: "normalized",
          min: 0,
          max: 1,
          defaultValue: 0.3,
          step: null,
          scale: "linear",
          clampPolicy: "clamp",
          automatable: true,
        },
      ],
      device({}),
    );
    expect(values.drive).toBe(0.3);
  });

  it("substitutes the default for a stored non-finite value", () => {
    const values = types.readDeviceParameters(
      [
        {
          id: "overdrive.tone",
          label: "Tone",
          unit: "normalized",
          min: 0,
          max: 1,
          defaultValue: 0.5,
          step: null,
          scale: "linear",
          clampPolicy: "clamp",
          automatable: true,
        },
      ],
      device({ tone: Number.NaN }),
    );
    // A NaN can never reach a Web Audio param — it would poison the node
    // permanently rather than merely sounding wrong.
    expect(values.tone).toBe(0.5);
  });
});

describe("shared wet/dry, output trim, and bypass", () => {
  it("splits between the dry input and the processed wet leg", async () => {
    const dry = rms(await render(device({ wet: 0, output: 0 })));
    const wet = rms(await render(device({ wet: 1, output: 0 })));
    // The core halves the signal, so full wet is half of full dry.
    expect(wet).toBeCloseTo(dry / 2, 2);
    // A 50% mix lands between them rather than snapping to either leg.
    const half = rms(await render(device({ wet: 0.5, output: 0 })));
    expect(half).toBeGreaterThan(wet);
    expect(half).toBeLessThan(dry);
  });

  it("applies output trim to the mixed signal", async () => {
    const flat = rms(await render(device({ wet: 1, output: 0 })));
    const boosted = rms(await render(device({ wet: 1, output: 12 })));
    const cut = rms(await render(device({ wet: 1, output: -12 })));
    expect(boosted / flat).toBeCloseTo(10 ** (12 / 20), 1);
    expect(cut / flat).toBeCloseTo(10 ** (-12 / 20), 1);
  });

  it("passes a bypassed device's input through untouched, trim included", async () => {
    const bypassed = rms(await render(device({ wet: 1, output: 12 }, true)));
    const dry = rms(await render(device({ wet: 0, output: 0 })));
    // Bypass is full-dry *and* neutral trim: a bypassed device must not be a
    // hidden gain stage (FX-01 "a device can be ... bypassed").
    expect(bypassed).toBeCloseTo(dry, 2);
  });

  it("never replaces a node for a bypass or parameter edit", () => {
    const node = build(device({ wet: 1, output: 0 }));
    const { input, output } = node;
    node.update(device({ wet: 0.2, output: 6 }, true));
    node.update(device({ wet: 1, output: 0 }, false));
    // `DeviceChain` only relinks when composition or order changes; holding
    // the same identity is what guarantees a bypass or knob move never
    // triggers one (FX-01: "do not rebuild unrelated audio nodes").
    expect(node.input).toBe(input);
    expect(node.output).toBe(output);
    node.dispose();
  });

  it("disposes every node it owns, idempotently", () => {
    const node = build(device({}));
    node.dispose();
    expect(() => node.dispose()).not.toThrow();
  });
});
