import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every projection is a pure function of a `Project` (PRD sections 9.2,
 * 9.7-9.8): the audio engine, the arrangement renderer, a dashboard list, and
 * the assistant each read one of these instead of Firebase, Tone.js, or
 * SolidJS state directly. None of these modules needs any of those imports.
 */

const projectionDirectory = join(process.cwd(), "src", "projection");

const FORBIDDEN_IMPORTS = ["firebase", "solid-js", "@solidjs/", "tone", "vitest"];

function sourceFiles(): string[] {
  return readdirSync(projectionDirectory).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
}

describe("projection boundaries", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(3);
  });

  it("imports no Firebase, Tone, Solid, or test-framework module", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(join(projectionDirectory, file), "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier.startsWith(forbidden), `${file} imports "${specifier}"`).toBe(
            false,
          );
        }
      }
    }
  });
});
