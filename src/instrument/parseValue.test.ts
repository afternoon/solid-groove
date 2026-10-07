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
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "120ms")).toBeCloseTo(0.12);
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "1.5 s")).toBe(1.5);
    // A bare number is always milliseconds, whatever the field was showing.
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "300")).toBeCloseTo(0.3);
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "2")).toBeCloseTo(0.002);
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "0.75")).toBeCloseTo(0.00075);
  });

  it("reads a bare number in the Delay Time field as ms, whatever it shows (GRV-59)", () => {
    const time = deviceParameter("delay", "time");
    // `750` is 750 ms, not 750 s clamped to 2 s, whether the field showed
    // "2 s" or "420 ms": the parse no longer reads what was displayed at all.
    expect(parseParameterInput(time, "750")).toBeCloseTo(0.75);
    // Explicit units still win.
    expect(parseParameterInput(time, "750 ms")).toBeCloseTo(0.75);
    expect(parseParameterInput(time, "0.75 s")).toBe(0.75);
    expect(parseParameterInput(time, "1.5sec")).toBe(1.5);
  });

  it("reads frequencies in Hz or with a k", () => {
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "2.4k")).toBe(2400);
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "2.4 kHz")).toBe(2400);
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "760 Hz")).toBe(760);
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "760")).toBe(760);
  });

  it("reads decibels, including the typographic minus and silence", () => {
    expect(parseParameterInput(TRACK_VOLUME, "-6")).toBe(-6);
    expect(parseParameterInput(TRACK_VOLUME, "−6.0 dB")).toBe(-6);
    expect(parseParameterInput(TRACK_VOLUME, "-inf")).toBe(TRACK_VOLUME.min);
    expect(parseParameterInput(TRACK_VOLUME, "−∞ dB")).toBe(TRACK_VOLUME.min);
  });

  it("reads semitones with a sign", () => {
    expect(parseParameterInput(SAMPLER_PITCH, "+3 st")).toBe(3);
    expect(parseParameterInput(SAMPLER_PITCH, "-12")).toBe(-12);
  });

  it("reads a 0..1 value as a percent and a wider one as itself", () => {
    expect(parseParameterInput(SAMPLER_SAMPLE_START, "45%")).toBeCloseTo(0.45);
    expect(parseParameterInput(SAMPLER_SAMPLE_START, "45")).toBeCloseTo(0.45);
    expect(parseParameterInput(SYNTH_FILTER_RESONANCE, "5.5")).toBe(5.5);
  });

  it("reads a compressor ratio typed as N:1", () => {
    expect(parseParameterInput(deviceParameter("compressor", "ratio"), "4:1")).toBe(4);
  });

  it("reads pan as C, L or R", () => {
    expect(parseParameterInput(TRACK_PAN, "C")).toBe(0);
    expect(parseParameterInput(TRACK_PAN, "L30")).toBeCloseTo(-0.3);
    expect(parseParameterInput(TRACK_PAN, "r100")).toBe(1);
    expect(parseParameterInput(TRACK_PAN, "-50")).toBe(-0.5);
  });

  it("reads a stepped value by its label", () => {
    const labels = ["1/16", "1/16 dotted", "1/8"];
    const division = deviceParameter("delay", "division");
    expect(parseParameterInput(division, "1/8", labels)).toBe(2);
    expect(parseParameterInput(division, "1/16 Dotted", labels)).toBe(1);
  });

  it("refuses what is not a value", () => {
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "")).toBeNull();
    expect(parseParameterInput(SYNTH_FILTER_CUTOFF, "loud")).toBeNull();
    expect(parseParameterInput(SYNTH_AMP_ATTACK, "12 bananas")).toBeNull();
    expect(parseParameterInput(TRACK_PAN, "L")).toBeNull();
  });
});
