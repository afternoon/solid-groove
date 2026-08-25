import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The command kernel is framework-free (PRD sections 9.2 and 9.6).
 *
 * Undo history is "local ... and does not depend on Firestore snapshots", the
 * assistant sends approved commands through this same layer, and the audio
 * engine consumes the resulting projection — none of which works if a command
 * can reach for a Firestore document, a Tone node, or a Solid signal. The
 * dependency runs one way: persistence, audio, and UI import commands, never
 * the reverse.
 */

const commandsDirectory = join(process.cwd(), "src", "commands");

const FORBIDDEN_IMPORTS = ["firebase", "solid-js", "@solidjs/", "tone", "vitest"];

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(commandsDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of readdirSync(join(commandsDirectory, entry.name))) {
        files.push(join(entry.name, nested));
      }
      continue;
    }
    files.push(entry.name);
  }
  return files.filter(
    (file) =>
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      // Test-only fixtures are not part of the shipped kernel.
      !file.endsWith("testProjects.ts"),
  );
}

describe("command layer boundaries", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(5);
  });

  it("imports no Firebase, Tone, Solid, or test-framework module", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(join(commandsDirectory, file), "utf8");
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

  it("reads the domain contract without reaching into other feature code", () => {
    const sourceRoot = join(process.cwd(), "src");
    for (const file of sourceFiles()) {
      const path = join(commandsDirectory, file);
      const source = readFileSync(path, "utf8");
      const relativeImports = [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) =>
        resolve(dirname(path), match[1]),
      );
      for (const target of relativeImports) {
        if (target.startsWith(commandsDirectory)) {
          continue;
        }
        const withinSource = relative(sourceRoot, target);
        expect(
          withinSource.startsWith("domain/") || withinSource.startsWith("shared/"),
          `${file} imports "${withinSource}" from outside the domain and shared modules`,
        ).toBe(true);
      }
    }
  });
});
