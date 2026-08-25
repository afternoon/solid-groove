import { describe, expect, it } from "vitest";
import {
  SAMPLER_PITCH,
  SAMPLER_SAMPLE_START,
  SYNTH_AMP_ATTACK,
  SYNTH_AMP_SUSTAIN,
  SYNTH_FILTER_CUTOFF,
  SYNTH_WAVEFORM,
} from "../domain/parameters";
import { formatInstrumentValue } from "./formatValue";

describe("formatInstrumentValue", () => {
  it("reads a waveform index as its name", () => {
    expect(formatInstrumentValue(SYNTH_WAVEFORM, 0)).toBe("Sine");
    expect(formatInstrumentValue(SYNTH_WAVEFORM, 2)).toBe("Sawtooth");
  });

  it("shows frequency in Hz below 1k and kHz above", () => {
    expect(formatInstrumentValue(SYNTH_FILTER_CUTOFF, 760)).toBe("760 Hz");
    expect(formatInstrumentValue(SYNTH_FILTER_CUTOFF, 8400)).toBe("8.4 kHz");
  });

  it("shows small envelope times in ms", () => {
    expect(formatInstrumentValue(SYNTH_AMP_ATTACK, 0.006)).toBe("6 ms");
  });

  it("shows a signed semitone pitch", () => {
    expect(formatInstrumentValue(SAMPLER_PITCH, 7)).toBe("+7 st");
    expect(formatInstrumentValue(SAMPLER_PITCH, -3)).toBe("-3 st");
    expect(formatInstrumentValue(SAMPLER_PITCH, 0)).toBe("0 st");
  });

  it("shows a normalized 0..1 parameter as a percent", () => {
    expect(formatInstrumentValue(SAMPLER_SAMPLE_START, 0.25)).toBe("25%");
    expect(formatInstrumentValue(SYNTH_AMP_SUSTAIN, 0.6)).toBe("60%");
  });
});
