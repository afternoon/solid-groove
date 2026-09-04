import { describe, expect, it } from "vitest";
import {
  bareParameterId,
  clampParameterValue,
  coerceParameterValue,
  defineParameter,
  getParameterDefinition,
  instrumentParameters,
  isAutomatable,
  isParameterValueInRange,
  MASTER_VOLUME,
  NOTE_VELOCITY,
  parameterDefinitions,
  parameterSchemaFor,
  readInstrumentParameter,
  requireParameterDefinition,
  SONG_TEMPO,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
  synthWaveform,
  TRACK_PAN,
  TRACK_VOLUME,
} from "./parameters";

describe("parameter definitions", () => {
  it("declares range, unit, default, clamping policy, and automation once", () => {
    expect(TRACK_VOLUME).toMatchObject({
      id: "track.volume",
      unit: "decibels",
      min: -60,
      max: 6,
      defaultValue: 0,
      clampPolicy: "clamp",
      automatable: true,
    });
    expect(SONG_TEMPO.unit).toBe("bpm");
    expect(SONG_TEMPO.automatable).toBe(false);
    expect(NOTE_VELOCITY.automatable).toBe(false);
    expect(MASTER_VOLUME.automatable).toBe(true);
  });

  it("registers exactly the parameters the alpha needs so far", () => {
    expect([...parameterDefinitions().keys()].sort()).toEqual([
      "clip.length",
      "master.volume",
      "note.probability",
      "note.velocity",
      "pad.attack",
      "pad.decay",
      "pad.pitch",
      "return.pan",
      "return.volume",
      "sampler.ampAttack",
      "sampler.ampDecay",
      "sampler.ampRelease",
      "sampler.ampSustain",
      "sampler.pitch",
      "sampler.sampleEnd",
      "sampler.sampleStart",
      "song.tempo",
      "synth.ampAttack",
      "synth.ampDecay",
      "synth.ampRelease",
      "synth.ampSustain",
      "synth.filterCutoff",
      "synth.filterResonance",
      "synth.waveform",
      "track.pan",
      "track.sendLevel",
      "track.volume",
    ]);
  });

  it("every registered definition has a default inside its own range", () => {
    for (const definition of parameterDefinitions().values()) {
      expect(isParameterValueInRange(definition, definition.defaultValue)).toBe(true);
      expect(definition.min).toBeLessThan(definition.max);
    }
  });

  it("rejects definitions with an impossible range, default, or step", () => {
    expect(() =>
      defineParameter({
        id: "bad.range",
        label: "Bad",
        unit: "normalized",
        min: 1,
        max: 0,
        defaultValue: 0,
        automatable: false,
      }),
    ).toThrow(/min < max/);
    expect(() =>
      defineParameter({
        id: "bad.default",
        label: "Bad",
        unit: "normalized",
        min: 0,
        max: 1,
        defaultValue: 2,
        automatable: false,
      }),
    ).toThrow(/outside its range/);
    expect(() =>
      defineParameter({
        id: "bad.step",
        label: "Bad",
        unit: "normalized",
        min: 0,
        max: 1,
        defaultValue: 0,
        step: 0,
        automatable: false,
      }),
    ).toThrow(/step must be a positive number/);
  });

  it("clamps out-of-range values and refuses non-finite ones", () => {
    expect(clampParameterValue(TRACK_VOLUME, 40)).toBe(6);
    expect(clampParameterValue(TRACK_VOLUME, -400)).toBe(-60);
    expect(clampParameterValue(TRACK_PAN, -1.5)).toBe(-1);
    // "non-finite" covers both NaN and +/-Infinity; exercise both kinds.
    expect(() => clampParameterValue(TRACK_PAN, Number.NaN)).toThrow(/non-finite/);
    expect(() => clampParameterValue(TRACK_PAN, Number.POSITIVE_INFINITY)).toThrow(
      /non-finite/,
    );
    expect(() => clampParameterValue(TRACK_PAN, Number.NEGATIVE_INFINITY)).toThrow(
      /non-finite/,
    );
  });

  it("quantizes to the declared step", () => {
    const stepped = defineParameter({
      id: "test.stepped",
      label: "Stepped",
      unit: "normalized",
      min: 0,
      max: 1,
      defaultValue: 0,
      step: 0.25,
      automatable: false,
    });
    expect(clampParameterValue(stepped, 0.3)).toBe(0.25);
    expect(clampParameterValue(stepped, 0.4)).toBe(0.5);
    expect(clampParameterValue(stepped, 9)).toBe(1);
  });

  it("applies the clamping policy when coercing command input", () => {
    expect(coerceParameterValue(TRACK_VOLUME, 40)).toEqual({
      ok: true,
      value: 6,
    });
    expect(coerceParameterValue(TRACK_VOLUME, Number.NaN)).toEqual({
      ok: false,
      reason: 'Parameter "track.volume" requires a finite number',
    });

    const strict = defineParameter({
      id: "test.strict",
      label: "Strict",
      unit: "normalized",
      min: 0,
      max: 1,
      defaultValue: 0,
      clampPolicy: "reject",
      automatable: false,
    });
    expect(coerceParameterValue(strict, 2).ok).toBe(false);
    expect(coerceParameterValue(strict, 0.5)).toEqual({ ok: true, value: 0.5 });
  });

  it("answers automation capability from the one definition", () => {
    expect(isAutomatable("track.volume")).toBe(true);
    expect(isAutomatable("song.tempo")).toBe(false);
    expect(isAutomatable("device.unregistered")).toBe(false);
    expect(getParameterDefinition("device.unregistered")).toBeUndefined();
    expect(() => requireParameterDefinition("device.unregistered")).toThrow(
      /Unknown parameter/,
    );
  });

  it("builds a runtime value schema from the definition", () => {
    const schema = parameterSchemaFor("track.pan");
    expect(schema.safeParse(0.5).success).toBe(true);
    expect(schema.safeParse(1.5).success).toBe(false);
    expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe("instrument parameters (LOOP-004)", () => {
  it("maps a waveform index onto its oscillator type, clamped in range", () => {
    expect(synthWaveform(0)).toBe("sine");
    expect(synthWaveform(2)).toBe("sawtooth");
    expect(synthWaveform(3)).toBe("triangle");
    // Out-of-range or fractional indices clamp/round rather than throw.
    expect(synthWaveform(-1)).toBe("sine");
    expect(synthWaveform(99)).toBe("triangle");
    expect(synthWaveform(1.4)).toBe("square");
  });

  it("reads a stored parameter or falls back to the definition default", () => {
    expect(readInstrumentParameter(SYNTH_FILTER_CUTOFF, {})).toBe(
      SYNTH_FILTER_CUTOFF.defaultValue,
    );
    expect(readInstrumentParameter(SYNTH_FILTER_CUTOFF, { filterCutoff: 800 })).toBe(800);
  });

  it("lists the parameters each instrument kind owns", () => {
    expect(instrumentParameters("synth").map((p) => p.id)).toContain(
      "synth.filterResonance",
    );
    expect(instrumentParameters("sampler").map((p) => p.id)).toContain(
      "sampler.sampleEnd",
    );
    expect(instrumentParameters("drumMachine")).toEqual([]);
  });

  it("strips the instrument namespace from a definition id", () => {
    expect(bareParameterId("synth.filterCutoff")).toBe("filterCutoff");
    expect(bareParameterId("sampler.pitch")).toBe("pitch");
    expect(bareParameterId("bare")).toBe("bare");
  });

  it("declares a resonant filter and a full amp envelope for the synth", () => {
    expect(SYNTH_FILTER_CUTOFF.unit).toBe("hertz");
    expect(SYNTH_FILTER_CUTOFF.automatable).toBe(true);
    expect(SYNTH_FILTER_RESONANCE.automatable).toBe(true);
    for (const stage of instrumentParameters("synth")) {
      expect(isParameterValueInRange(stage, stage.defaultValue)).toBe(true);
    }
  });
});
