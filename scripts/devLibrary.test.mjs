// #838: under `bun run dev:mock` the sound library was "unavailable".
//
// With no storage bucket configured, the app reads the factory library
// same-origin, out of `public/samples/starter-library` (see
// `resolveLibraryBucket` in `src/library/manifest.ts`). The dev server can only
// serve the pack index and manifests if something wrote them there before it
// started — and the `dev` scripts' pre-hooks only rendered the runtime's audio,
// never the index, so `packs/index.json` 404'd and the browser reported the
// library as not found.
//
// This runs the real `predev:mock` hook, from a checkout with no pack index,
// and asserts the file the library browser fetches first is on disk afterwards.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_OUT_DIR } from "./starter-library/build.mjs";
import { PACK_INDEX_KEY } from "./starter-library/manifest.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;

describe("the dev servers' pre-hooks", () => {
  it("all prepare the same local library before serving", () => {
    // One behavioural run below covers all three only while they agree.
    expect(scripts.predev).toBe(scripts["predev:mock"]);
    expect(scripts["predev:emulator"]).toBe(scripts["predev:mock"]);
  });

  it("write the pack index the library browser fetches same-origin", () => {
    const packsDir = join(DEFAULT_OUT_DIR, dirname(PACK_INDEX_KEY));
    rmSync(packsDir, { recursive: true, force: true });

    const run = spawnSync("bun", ["run", "predev:mock"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);

    expect(existsSync(join(DEFAULT_OUT_DIR, PACK_INDEX_KEY))).toBe(true);
  }, 180_000);
});
