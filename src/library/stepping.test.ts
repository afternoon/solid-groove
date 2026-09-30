import { describe, expect, it } from "vitest";
import { libraryAsset as sound } from "./__fixtures__/assets";
import { shelfRoles } from "./shelf";
import { nextIn, previousIn, roleForDigit } from "./stepping";

describe("stepping and digit keys", () => {
  const items = ["a", "b", "c"];
  it("steps forward and back, clamped at the ends", () => {
    expect(nextIn(items, "a")).toBe("b");
    expect(nextIn(items, "c")).toBe("c");
    expect(previousIn(items, "c")).toBe("b");
    expect(previousIn(items, "a")).toBe("a");
  });
  it("starts from the first item when nothing is current", () => {
    expect(nextIn(items, null)).toBe("a");
    expect(previousIn(items, null)).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(nextIn([], null)).toBeNull();
    expect(previousIn([], null)).toBeNull();
  });
  it("maps 0 to all roles and 1-9 to the nth role", () => {
    const roles = shelfRoles(
      [sound({ role: "kick" }), sound({ role: "snare" })],
      "drums",
    );
    expect(roleForDigit(roles, 0)).toBeNull();
    expect(roleForDigit(roles, 1)).toBe("kick");
    expect(roleForDigit(roles, 2)).toBe("snare");
    expect(roleForDigit(roles, 3)).toBeUndefined();
  });
});
