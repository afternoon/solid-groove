// #838: under `bun run dev:mock` the library browser reported the library as
// unavailable, because nothing had built the pack index it fetches same-origin
// and nothing said so. The dev scripts now warn and point at the docs.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_LIBRARY_DOCS, localLibraryWarning } from "./checkLocal.mjs";
import { PACK_INDEX_KEY } from "./manifest.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;

describe("localLibraryWarning", () => {
  let outDir;
  afterEach(() => rmSync(outDir, { recursive: true, force: true }));

  it("warns, naming the build command and the docs, when the pack index is missing", () => {
    outDir = mkdtempSync(join(tmpdir(), "groove-library-"));
    const warning = localLibraryWarning({ outDir, bucket: undefined });
    expect(warning).toContain("bun run library:build");
    expect(warning).toContain(LOCAL_LIBRARY_DOCS);
  });

  it("stays quiet once the pack index exists", () => {
    outDir = mkdtempSync(join(tmpdir(), "groove-library-"));
    mkdirSync(join(outDir, dirname(PACK_INDEX_KEY)), { recursive: true });
    writeFileSync(join(outDir, PACK_INDEX_KEY), "{}");
    expect(localLibraryWarning({ outDir, bucket: undefined })).toBeNull();
  });

  it("stays quiet when a bucket delivers the library instead", () => {
    outDir = mkdtempSync(join(tmpdir(), "groove-library-"));
    expect(localLibraryWarning({ outDir, bucket: "groove.appspot.com" })).toBeNull();
  });
});

describe("the dev servers' pre-hooks", () => {
  it.each(["predev", "predev:mock", "predev:emulator"])("%s runs the check", (hook) => {
    expect(scripts[hook]).toContain("scripts/starter-library/checkLocal.mjs");
  });
});

it("the docs the warning points at have that section", () => {
  const contributing = readFileSync(join(REPO_ROOT, "CONTRIBUTING.md"), "utf8");
  expect(contributing).toContain("### The sound library on a local dev server");
});
