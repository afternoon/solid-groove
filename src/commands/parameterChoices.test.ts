import { describe, expect, it } from "vitest";
import { deviceParameters } from "../domain/devices";
import { CLIP_LENGTH, SYNTH_WAVEFORM } from "../domain/parameters";
import { summarizeParameterChoice } from "./parameterChoices";

const delay = (id: string) => {
  const definition = deviceParameters("delay").find((d) => d.id === `delay.${id}`);
  if (!definition) throw new Error(`no delay.${id}`);
  return definition;
};

// GRV-63: a mode edit reads in the undo history as the user saw it.
describe("summarizeParameterChoice", () => {
  it("names a choice by its label, not its stored index", () => {
    expect(summarizeParameterChoice(delay("division"), 3)).toBe("Set Division to 1/8");
    expect(summarizeParameterChoice(SYNTH_WAVEFORM, 0)).toBe("Set Waveform to Sine");
    const [mode] = deviceParameters("filter").filter((d) => d.id === "filter.mode");
    expect(summarizeParameterChoice(mode, 1)).toBe("Set Mode to High pass");
  });

  it("turns a switch on or off", () => {
    expect(summarizeParameterChoice(delay("sync"), 1)).toBe("Turn Sync on");
    expect(summarizeParameterChoice(delay("sync"), 0)).toBe("Turn Sync off");
    const lowShelf = deviceParameters("eq").find((d) => d.id === "eq.lowShelfOn");
    expect(lowShelf && summarizeParameterChoice(lowShelf, 0)).toBe("Turn Low shelf off");
  });

  it("leaves continuous and unnamed stepped values to the unit formatter", () => {
    expect(summarizeParameterChoice(delay("feedback"), 0.5)).toBeNull();
    expect(summarizeParameterChoice(CLIP_LENGTH, 4)).toBeNull();
  });
});
