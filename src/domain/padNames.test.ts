import { describe, expect, it } from "vitest";
import { createDrumPad, createFactoryContext } from "./factories";
import { isAutoPadName, nextPadName } from "./padNames";

describe("padNames", () => {
  it("recognises only generated names as automatic", () => {
    expect(isAutoPadName("Pad 1")).toBe(true);
    expect(isAutoPadName("Pad 12")).toBe(true);
    for (const name of ["Kick", "pad 1", "Pad", "Pad 0", "Pad 1b", " Pad 1"]) {
      expect(isAutoPadName(name)).toBe(false);
    }
  });

  it("names the next pad after the first free number", () => {
    const context = createFactoryContext();
    expect(nextPadName([])).toBe("Pad 1");
    expect(nextPadName([createDrumPad(context, { name: "Pad 2" })])).toBe("Pad 3");
    expect(isAutoPadName(nextPadName([]))).toBe(true);
  });
});
