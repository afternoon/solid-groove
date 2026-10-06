/**
 * The deployed Functions bundle can load (#69).
 *
 * `firebase.json`'s predeploy builds `functions/lib/index.js` with
 * `--packages external`, so every package the bundle reaches, including
 * through `src/` modules it shares with the app (`zod` and `nanoid` via
 * `src/domain`), stays a bare import, and the deploy installs only what
 * `functions/package.json` declares. A package missing from there fails the
 * whole codebase at load: the sign-in gate, the storage triggers and the
 * assistant together. This builds the bundle exactly as the predeploy does
 * and checks every bare import is declared.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

type Manifest = { dependencies?: Record<string, string> };

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** The package a bare specifier names: `@scope/name/sub` -> `@scope/name`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

/** The packages an ESM bundle imports, Node's built-ins and relative paths left out. */
export function bareImports(bundle: string): string[] {
  const builtins = new Set(builtinModules);
  const found = new Set<string>();
  const pattern = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
  for (const match of bundle.matchAll(pattern)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    if (specifier.startsWith("node:") || builtins.has(packageOf(specifier))) continue;
    found.add(packageOf(specifier));
  }
  return [...found].sort();
}

describe("bareImports", () => {
  it("names the package behind each import form and skips built-ins", () => {
    const bundle = [
      'import { z } from "zod";',
      'import * as admin from "firebase-admin/app";',
      'import "@scope/pkg/side-effect";',
      'const lazy = await import("nanoid");',
      'import { readFile } from "node:fs/promises";',
      'import path from "path";',
      'import local from "./local.js";',
    ].join("\n");
    expect(bareImports(bundle)).toEqual([
      "@scope/pkg",
      "firebase-admin",
      "nanoid",
      "zod",
    ]);
  });
});

describe("the built functions bundle", () => {
  const outdir = mkdtempSync(join(tmpdir(), "functions-bundle-"));
  afterAll(() => rmSync(outdir, { recursive: true, force: true }));

  it("declares every package it imports in functions/package.json", () => {
    execFileSync(
      "bun",
      [
        "build",
        join(ROOT, "functions/src/index.ts"),
        "--outdir",
        outdir,
        "--target",
        "node",
        "--format",
        "esm",
        "--packages",
        "external",
      ],
      { cwd: ROOT, stdio: "pipe" },
    );
    const imports = bareImports(readFileSync(join(outdir, "index.js"), "utf8"));
    const functions = readManifest(join(ROOT, "functions/package.json"));
    const declared = functions.dependencies ?? {};

    expect(imports).toContain("firebase-functions");
    expect(imports.filter((name) => !(name in declared))).toEqual([]);
  }, 60_000);
});
