import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The selection model is UI-only state, but it is not itself a UI framework
 * binding (PRD section 9.2): it names canonical entities by stable ID and
 * reads a `Project` to reconcile itself, nothing more. A Firestore
 * `Timestamp`, a Tone node, or a Solid signal never needs to reach it.
 */

const selectionDirectory = join(process.cwd(), "src", "selection");

const FORBIDDEN_IMPORTS = ["firebase", "solid-js", "@solidjs/", "tone", "vitest"];

function sourceFiles(): string[] {
  return readdirSync(selectionDirectory).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
}

describe("selection boundaries", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it("imports no Firebase, Tone, Solid, or test-framework module", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(join(selectionDirectory, file), "utf8");
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
