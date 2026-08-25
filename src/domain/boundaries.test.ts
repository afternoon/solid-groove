import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The domain model is framework-free (PRD section 9.2). Persistence, audio, and
 * UI consume it from the outside, so a Firestore `Timestamp`, a Tone node, or a
 * Solid signal can never reach stored project state.
 */

const domainDirectory = join(process.cwd(), "src", "domain");

const FORBIDDEN_IMPORTS = ["firebase", "solid-js", "@solidjs/", "tone", "vitest"];

function sourceFiles(): string[] {
  return readdirSync(domainDirectory).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
}

describe("domain boundaries", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(5);
  });

  it("imports no Firebase, Tone, Solid, or test-framework module", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(join(domainDirectory, file), "utf8");
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
