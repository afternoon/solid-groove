import { describe, expect, it } from "vitest";
import { deviceParameters, deviceTypes } from "../domain/devices";
import { bareParameterId, type ParameterDefinition } from "../domain/parameters";
import {
  deviceExtremeLabel,
  deviceValueExtreme,
  discreteDeviceOptions,
  formatDeviceValue,
  isDiscreteDeviceParameter,
} from "./deviceValue";

/** The definition of one registered device parameter, by its bare id. */
function definitionOf(type: string, id: string): ParameterDefinition {
  const found = deviceParameters(type).find(
    (candidate) => bareParameterId(candidate.id) === id,
  );
  if (!found) throw new Error(`${type}.${id} is not registered`);
  return found;
}

describe("formatDeviceValue", () => {
  it("reads a discrete parameter as its name, not its stored index", () => {
    // `filter.mode`, `delay.sync` and `delay.division` are stored as numbers
    // because schema v1's parameter map is numeric; none of them is a quantity.
    expect(formatDeviceValue(definitionOf("filter", "mode"), 0)).toBe("Lowpass");
    expect(formatDeviceValue(definitionOf("filter", "mode"), 1)).toBe("Highpass");
    expect(formatDeviceValue(definitionOf("filter", "mode"), 2)).toBe("Bandpass");
    expect(formatDeviceValue(definitionOf("delay", "sync"), 0)).toBe("Free");
    expect(formatDeviceValue(definitionOf("delay", "sync"), 1)).toBe("Synced");
    expect(formatDeviceValue(definitionOf("delay", "division"), 3)).toBe("1/8");
    expect(formatDeviceValue(definitionOf("delay", "division"), 2)).toBe("1/8 triplet");
  });

  it("prints a compressor's ratio as a relationship", () => {
    expect(formatDeviceValue(definitionOf("compressor", "ratio"), 4)).toBe("4.0:1");
    expect(formatDeviceValue(definitionOf("compressor", "ratio"), 20)).toBe("20.0:1");
  });

  it("carries each unit through in the vocabulary the instrument panel uses", () => {
    expect(formatDeviceValue(definitionOf("filter", "cutoff"), 760)).toBe("760 Hz");
    expect(formatDeviceValue(definitionOf("filter", "cutoff"), 8000)).toBe("8 kHz");
    expect(formatDeviceValue(definitionOf("overdrive", "drive"), 0.8)).toBe("80%");
    expect(formatDeviceValue(definitionOf("overdrive", "output"), -6)).toBe("-6 dB");
    expect(formatDeviceValue(definitionOf("reverb", "predelay"), 0.01)).toBe("10 ms");
    expect(formatDeviceValue(definitionOf("reverb", "decay"), 2.5)).toBe("2.5 s");
  });

  it("gives every registered device parameter a non-empty reading", () => {
    // The panel generates its controls from the registry, so a device type
    // added later must not land a blank readout under one of its sliders.
    for (const type of deviceTypes()) {
      for (const definition of type.parameters) {
        for (const value of [definition.min, definition.defaultValue, definition.max]) {
          expect(
            formatDeviceValue(definition, value),
            `${definition.id} at ${value}`,
          ).not.toBe("");
        }
      }
    }
  });
});

describe("discrete parameters", () => {
  it("identifies exactly the stepped, non-automatable ones", () => {
    for (const type of deviceTypes()) {
      for (const definition of type.parameters) {
        // A discrete parameter is precisely one the domain declared stepped and
        // refused to automate; nothing else may claim a name-based reading.
        const discrete = isDiscreteDeviceParameter(definition);
        expect(discrete, definition.id).toBe(
          definition.step === 1 && !definition.automatable,
        );
      }
    }
  });

  it("lists a discrete parameter's options in stored-index order", () => {
    expect(discreteDeviceOptions(definitionOf("filter", "mode"))).toEqual([
      "Lowpass",
      "Highpass",
      "Bandpass",
    ]);
    expect(discreteDeviceOptions(definitionOf("delay", "division"))).toHaveLength(7);
    expect(discreteDeviceOptions(definitionOf("delay", "division"))[0]).toBe("1/16");
    // A continuous parameter has no option list at all.
    expect(discreteDeviceOptions(definitionOf("overdrive", "drive"))).toEqual([]);
  });
});

describe("deviceValueExtreme (PRD FX-02)", () => {
  it("reports a value driven to a bound, and names it", () => {
    const drive = definitionOf("overdrive", "drive");
    expect(deviceValueExtreme(drive, 1)).toBe("max");
    expect(deviceExtremeLabel(deviceValueExtreme(drive, 1))).toBe("at maximum");

    const feedback = definitionOf("delay", "feedback");
    // The near-runaway end of a feedback range is exactly what FX-02 says must
    // be reachable and labelled rather than quietly pulled back.
    expect(deviceValueExtreme(feedback, feedback.max)).toBe("max");
    expect(deviceExtremeLabel(deviceValueExtreme(feedback, 0))).toBe("at minimum");
  });

  it("does not call a factory setting extreme", () => {
    // `delay.spread` defaults to its own minimum, and `delay.sync` to its max.
    // Labelling a value the producer never touched would make the label noise.
    for (const type of deviceTypes()) {
      for (const definition of type.parameters) {
        expect(
          deviceValueExtreme(definition, definition.defaultValue),
          definition.id,
        ).toBeNull();
      }
    }
  });

  it("says nothing about a value in the middle of its range", () => {
    const cutoff = definitionOf("filter", "cutoff");
    expect(deviceValueExtreme(cutoff, 1000)).toBeNull();
    expect(deviceValueExtreme(cutoff, 5000)).toBeNull();
    expect(deviceExtremeLabel(null)).toBeNull();
  });

  it("never reports an extreme for a discrete choice", () => {
    // "Bandpass" is not an extreme setting of anything; it is the last name in
    // a list that happens to be stored as the range's maximum.
    expect(deviceValueExtreme(definitionOf("filter", "mode"), 2)).toBeNull();
    expect(deviceValueExtreme(definitionOf("delay", "division"), 6)).toBeNull();
  });

  it("reports rather than clamps — the value it was given comes back unchanged", () => {
    // The whole point of FX-02: the panel says "at maximum", it does not move
    // the value. Nothing here normalizes toward a conservative sound.
    const decay = definitionOf("reverb", "decay");
    expect(deviceValueExtreme(decay, decay.max)).toBe("max");
    expect(formatDeviceValue(decay, decay.max)).toBe("30 s");
  });
});
