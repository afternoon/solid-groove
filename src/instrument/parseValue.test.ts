import { describe, expect, it } from "vitest";
import { deviceTypeDefinition } from "../domain/devices";
import {
  type ParameterDefinition,
  SAMPLER_PITCH,
  SAMPLER_SAMPLE_START,
  SYNTH_AMP_ATTACK,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
  TRACK_PAN,
  TRACK_VOLUME,
} from "../domain/parameters";
import { parseParameterInput } from "./parseValue";

function deviceParameter(type: string, id: string): ParameterDefinition {
  const found = deviceTypeDefinition(type)?.parameters.find(
    (p) => p.id === `${type}.${id}`,
  );
  if (!found) throw new Error(`no ${type}.${id}`);
  return found;
}

describe("parseParameterInput", () => {
  it("reads times with and without a unit", () => {
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "120ms", 0.4)).toBeCloseTo(0.12);
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "1.5 s", 0.4)).toBe(1.5);
    // A bare number means the unit the field was showing.
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "300", 0.42)).toBeCloseTo(0.3);
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "2", 1.5)).toBe(2);
  });

  it("reads frequencies in Hz or with a k", () => {
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "2.4k", 1000)).toBe(2400);
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "2.4 kHz", 1000)).toBe(2400);
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "760 Hz", 1000)).toBe(760);
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "760", 1000)).toBe(760);
  });

  it("reads decibels, including the typographic minus and silence", () => {
    expect(parseParameterInput(TRACK_VOLUME, "-6", 0)).toBe(-6);
    expect(parseParameterInput(TRACK_VOLUME, "−6.0 dB", 0)).toBe(-6);
    expect(parseParameterInput(TRACK_VOLUME, "-inf", 0)).toBe(TRACK_VOLUME.min);
    expect(parseParameterInput(TRACK_VOLUME, "−∞ dB", 0)).toBe(TRACK_VOLUME.min);
  });

  it("reads semitones with a sign", () => {
    expect(parseParameterInput(SAMPLER_PITCH, "+3 st", 0)).toBe(3);
    expect(parseParameterInput(SAMPLER_PITCH, "-12", 0)).toBe(-12);
  });

  it("reads a 0..1 value as a percent and a wider one as itself", () => {
    expect(parseParameterInput(SAMPLER_SAMPLE_START, "45%", 0)).toBeCloseTo(0.45);
    expect(parseParameterInput(SAMPLER_SAMPLE_START, "45", 0)).toBeCloseTo(0.45);
    expect(parseParameterInput(SYNTH_FILTER_RESONANCE, "5.5", 1)).toBe(5.5);
  });

  it("reads a compressor ratio typed as N:1", () => {
    expect(parseParameterInput(deviceParameter("compressor", "ratio"), "4:1", 2)).toBe(4);
  });

  it("reads pan as C, L or R", () => {
    expect(parseParameterInput(TRACK_PAN, "C", 0.2)).toBe(0);
    expect(parseParameterInput(TRACK_PAN, "L30", 0)).toBeCloseTo(-0.3);
    expect(parseParameterInput(TRACK_PAN, "r100", 0)).toBe(1);
    expect(parseParameterInput(TRACK_PAN, "-50", 0)).toBe(-0.5);
  });

  it("reads a stepped value by its label", () => {
    const labels = ["1/16", "1/16 dotted", "1/8"];
    const division = deviceParameter("delay", "division");
    expect(parseParameterInput(division, "1/8", 0, labels)).toBe(2);
    expect(parseParameterInput(division, "1/16 Dotted", 0, labels)).toBe(1);
  });

  it("refuses what is not a value", () => {
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "", 1000)).toBeNull();
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "loud", 1000)).toBeNull();
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "12 bananas", 0.1)).toBeNull();
    expect(parseParameterInput(TRACK_PAN, "L", 0)).toBeNull();
  });
});
