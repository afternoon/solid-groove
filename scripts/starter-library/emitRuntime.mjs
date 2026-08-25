#!/usr/bin/env node
// Emits the generated runtime library module and the audio it points at.
//
//   bun run library:emit-runtime            # write the module and any missing audio
//   bun run library:emit-runtime -- --force # re-render the audio too
//   bun run library:emit-runtime -- --check # fail if the committed module is stale
//
// `--check` is the drift gate: the module is committed (the app imports it, and
// unit tests must not need a build step), so CI has to be able to say "this was
// generated from a different catalogue than the one in the tree". The same
// assertion runs in the unit suite via `runtime.test.mjs`.
//
// Audio is written only when missing, so this is cheap enough to run from
// `predev`, `prebuild`, and `pretest:browser` the way `generate-samples.mjs`
// already is.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntimeLibrary, renderRuntimeModule } from "./runtime.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Committed: the app imports it, so it cannot be a build artifact. */
export const MODULE_PATH = join(
  REPO_ROOT,
  "src",
  "library",
  "factoryLibrary.generated.ts",
);

/** Gitignored via `public/samples` — rendered audio is never committed. */
export const AUDIO_DIR = join(REPO_ROOT, "public", "samples", "starter-library", "audio");

export function parseArgs(argv) {
  const args = { force: false, check: false, quiet: false };
  for (const flag of argv) {
    if (flag === "--force") args.force = true;
    else if (flag === "--check") args.check = true;
    else if (flag === "--quiet") args.quiet = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

export function emitRuntime({ force = false, check = false, log = console.log } = {}) {
  const library = buildRuntimeLibrary();
  const source = renderRuntimeModule(library);

  if (check) {
    const committed = existsSync(MODULE_PATH) ? readFileSync(MODULE_PATH, "utf8") : null;
    if (committed !== source) {
      throw new Error(
        "src/library/factoryLibrary.generated.ts is stale. Run `bun run library:emit-runtime`.",
      );
    }
    log("generated runtime library module is up to date");
    return { written: 0, module: MODULE_PATH };
  }

  mkdirSync(dirname(MODULE_PATH), { recursive: true });
  writeFileSync(MODULE_PATH, source);

  let written = 0;
  for (const file of library.files) {
    const path = join(AUDIO_DIR, file.storageKey);
    if (!force && existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
    written++;
  }

  log(`wrote ${MODULE_PATH.replace(`${REPO_ROOT}/`, "")} and ${written} audio file(s)`);
  return { written, module: MODULE_PATH };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    emitRuntime({ ...args, log: args.quiet ? () => {} : console.log });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
