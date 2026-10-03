import { beforeAll, describe, expect, it } from "vitest";
import { createDevice, defaultDeviceParameters, EQ_BANDS } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceId } from "../../domain/ids";
import { installWebAudioGlobals, rms } from "../testAudioContext";
import {
  type EqStageSetting,
  eqResponseDb,
  eqStageSettings,
  stageMagnitude,
} from "./eqResponse";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let deviceNode: typeof import("./deviceNode");
let eq: typeof import("./eq");

beforeAll(async () => {
  Tone = await import("tone");
  deviceNode = await import("./deviceNode");
  eq = await import("./eq");
});

const context = { scope: null as never, tempo: () => 120 };
const RATE = 48_000;

function values(overrides: Record<string, number> = {}): Record<string, number> {
  return { ...defaultDeviceParameters("eq"), ...overrides };
}

function device(overrides: Record<string, number> = {}): Device {
  return {
    ...createDevice("dev_eq" as DeviceId, "eq", 0),
    parameters: values(overrides),
  };
}

/**
 * One render with the source on channel 0 and the same source through the EQ
 * on channel 1, so the two can be compared sample for sample — a noise source
 * differs between renders, so they must share one.
 */
async function renderThrough(
  d: Device,
  source: "noise" | number,
): Promise<{ dry: Float32Array; wet: Float32Array }> {
  const buffer = await Tone.Offline(
    () => {
      const node = deviceNode.buildDeviceNode(d, context, eq.createEqCore);
      const input =
        source === "noise"
          ? new Tone.Noise("white")
          : new Tone.Oscillator({ type: "sine", frequency: source });
      const level = new Tone.Gain(0.25);
      const merge = new Tone.Merge();
      input.connect(level);
      level.connect(merge, 0, 0);
      level.connect(node.input);
      node.output.connect(merge, 0, 1);
      merge.toDestination();
      input.start(0);
    },
    0.5,
    2,
    RATE,
  );
  return { dry: buffer.getChannelData(0), wet: buffer.getChannelData(1) };
}

/** The settled part of a render, past any filter's start-up transient. */
const settled = (data: Float32Array) => data.subarray(Math.floor(0.1 * RATE));

describe("EQ response (LOOP-022)", () => {
  it("is flat by default, at every frequency", () => {
    for (const hz of [20, 60, 200, 1_000, 5_000, 12_000, 20_000]) {
      expect(Math.abs(eqResponseDb(values(), hz))).toBeLessThan(1e-9);
    }
  });

  it("lifts the lows with the low shelf and the highs with the high shelf", () => {
    const lows = values({ lowShelfGain: 12, lowShelfFreq: 200 });
    expect(eqResponseDb(lows, 30)).toBeCloseTo(12, 0);
    expect(Math.abs(eqResponseDb(lows, 10_000))).toBeLessThan(0.1);
    const highs = values({ highShelfGain: -12, highShelfFreq: 4_000 });
    expect(eqResponseDb(highs, 18_000)).toBeCloseTo(-12, 0);
    expect(Math.abs(eqResponseDb(highs, 100))).toBeLessThan(0.1);
  });

  it("puts a peak's full gain at its frequency", () => {
    const bell = values({ peak1Freq: 1_000, peak1Gain: 9, peak1Q: 2 });
    expect(eqResponseDb(bell, 1_000)).toBeCloseTo(9, 5);
    expect(Math.abs(eqResponseDb(bell, 100))).toBeLessThan(0.2);
  });

  it("cuts only once a cut is switched in, at 12 dB per octave", () => {
    expect(eqResponseDb(values({ lowCutFreq: 400 }), 50)).toBeCloseTo(0, 5);
    const cut = values({ lowCutOn: 1, lowCutFreq: 400 });
    // Three octaves below a Butterworth corner: about -36 dB.
    expect(eqResponseDb(cut, 50)).toBeLessThan(-34);
    expect(eqResponseDb(cut, 400)).toBeCloseTo(-3, 0);
    const top = values({ highCutOn: 1, highCutFreq: 2_000 });
    expect(eqResponseDb(top, 16_000)).toBeLessThan(-34);
  });

  it("ignores a band's gain while it is switched off", () => {
    expect(eqResponseDb(values({ peak2Gain: 12, peak2On: 0 }), 3_000)).toBeCloseTo(0, 9);
    expect(eqResponseDb(values({ lowShelfGain: 12, lowShelfOn: 0 }), 30)).toBeCloseTo(
      0,
      9,
    );
  });

  it("gives a shelf resonance at its corner as its Q rises, and none when flat", () => {
    const plain = values({ lowShelfGain: 12, lowShelfFreq: 200 });
    const resonant = values({ lowShelfGain: 12, lowShelfFreq: 200, lowShelfQ: 4 });
    expect(eqResponseDb(resonant, 200)).toBeGreaterThan(eqResponseDb(plain, 200) + 3);
    // Still the same shelf far from the corner.
    expect(eqResponseDb(resonant, 20)).toBeCloseTo(eqResponseDb(plain, 20), 0);
    expect(eqResponseDb(values({ lowShelfQ: 6 }), 120)).toBeCloseTo(0, 9);
  });

  it("matches a real BiquadFilterNode's response for every kind of stage", () => {
    const stages: EqStageSetting[] = eqStageSettings(
      values({
        lowCutOn: 1,
        lowCutFreq: 90,
        lowCutQ: 2.5,
        lowShelfGain: 7,
        lowShelfQ: 3,
        peak1Gain: -9,
        peak1Q: 4,
        highShelfGain: -5,
        highCutOn: 1,
        highCutFreq: 9_000,
        highCutQ: 0.4,
      }),
    );
    const offline = new OfflineAudioContext(1, 128, RATE);
    const frequencies = Float32Array.from([30, 90, 250, 1_000, 4_000, 9_000, 16_000]);
    const magnitudes = new Float32Array(frequencies.length);
    const phases = new Float32Array(frequencies.length);
    for (const stage of stages) {
      const node = offline.createBiquadFilter();
      node.type = stage.type;
      node.frequency.value = stage.frequency;
      node.Q.value = stage.q;
      node.gain.value = stage.gain;
      node.getFrequencyResponse(frequencies, magnitudes, phases);
      frequencies.forEach((hz, i) => {
        const drawn = 20 * Math.log10(stageMagnitude(stage, hz, RATE));
        const heard = 20 * Math.log10(magnitudes[i]);
        expect(drawn, `${stage.band} ${stage.type} at ${hz} Hz`).toBeCloseTo(heard, 2);
      });
    }
  });
});

describe("EQ core (LOOP-022)", () => {
  it("passes its input through unchanged when flat", async () => {
    const { dry, wet } = await renderThrough(device(), "noise");
    expect(rms(dry)).toBeGreaterThan(0.05);
    let worst = 0;
    for (let i = 0; i < dry.length; i++)
      worst = Math.max(worst, Math.abs(dry[i] - wet[i]));
    expect(worst).toBeLessThan(1e-5);
  });

  it("takes the lows out with the low cut switched in", async () => {
    const { dry, wet } = await renderThrough(
      device({ lowCutOn: 1, lowCutFreq: 800 }),
      60,
    );
    expect(rms(settled(wet))).toBeLessThan(rms(settled(dry)) * 0.01);
  });

  it("lifts a peak by its gain at its frequency", async () => {
    const { dry, wet } = await renderThrough(
      device({ peak1Freq: 1_000, peak1Gain: 12, peak1Q: 1 }),
      1_000,
    );
    const ratio = rms(settled(wet)) / rms(settled(dry));
    expect(20 * Math.log10(ratio)).toBeCloseTo(12, 0);
  });

  it("sounds the way its curve is drawn, band by band", async () => {
    const settings = {
      lowShelfGain: -6,
      lowShelfFreq: 300,
      peak2Freq: 2_500,
      peak2Gain: 8,
      peak2Q: 3,
      highShelfGain: 4,
    };
    for (const hz of [100, 2_500, 14_000]) {
      const { dry, wet } = await renderThrough(device(settings), hz);
      const heard = 20 * Math.log10(rms(settled(wet)) / rms(settled(dry)));
      expect(heard, `${hz} Hz`).toBeCloseTo(eqResponseDb(values(settings), hz, RATE), 0);
    }
  });

  it("offers its output spectrum to the panel, which other devices do not", async () => {
    const filter = await import("./filter");
    let lengths: number[] = [];
    let binHz = 0;
    let filterReads = true;
    await Tone.Offline(
      () => {
        const node = deviceNode.buildDeviceNode(device(), context, eq.createEqCore);
        const reading = node.readSpectrum?.();
        lengths = reading ? [reading.db.length] : [];
        binHz = reading?.binHz ?? 0;
        const plain = deviceNode.buildDeviceNode(
          { ...createDevice("dev_filter" as DeviceId, "filter", 1) },
          context,
          filter.createFilterCore,
        );
        filterReads = plain.readSpectrum !== undefined;
      },
      0.05,
      1,
      RATE,
    );
    expect(lengths).toEqual([1024]);
    expect(binHz).toBeCloseTo(RATE / 2048, 9);
    expect(filterReads).toBe(false);
  });

  it("builds one fixed set of stages, whatever is switched in", () => {
    // Every band's stages exist from the start, so switching a band in or out
    // retunes a node and never adds one, and the chain never relinks for it.
    const off = eqStageSettings(values());
    const on = eqStageSettings(
      values(Object.fromEntries(EQ_BANDS.map((band) => [`${band.id}On`, 1]))),
    );
    expect(on.map((stage) => stage.type)).toEqual(off.map((stage) => stage.type));
  });
});
