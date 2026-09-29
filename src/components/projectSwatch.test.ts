import { describe, expect, it } from "vitest";
import { TRACK_COLORS } from "../domain/factories";
import { projectSwatchColor } from "./projectSwatch";

describe("projectSwatchColor", () => {
  it("is deterministic for an ID", () => {
    expect(projectSwatchColor("prj_abc")).toBe(projectSwatchColor("prj_abc"));
  });

  it("only ever picks a track colour", () => {
    for (let i = 0; i < 200; i++) {
      expect(TRACK_COLORS).toContain(projectSwatchColor(`prj_${i}`));
    }
  });

  it("spreads different IDs across the palette", () => {
    const picked = new Set(
      Array.from({ length: 200 }, (_, i) => projectSwatchColor(`prj_${i}`)),
    );
    expect(picked.size).toBeGreaterThan(TRACK_COLORS.length / 2);
  });
});
