#!/usr/bin/env node
// Run before every dev server: warn when the local sound library is missing.
//
// With no storage bucket configured the app reads the library same-origin, out
// of `public/samples/starter-library` (`resolveLibraryBucket` in
// `src/library/manifest.ts`). Only `library:build` writes the pack index there,
// and it takes about fifteen seconds, so the dev scripts do not run it. Without
// it the library browser shows "This library is unavailable." (#838), so say
// so up front and point at the docs rather than leave a 404 to be decoded.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_OUT_DIR } from "./build.mjs";
import { PACK_INDEX_KEY } from "./manifest.mjs";

export const LOCAL_LIBRARY_DOCS =
  "CONTRIBUTING.md#the-sound-library-on-a-local-dev-server";

/** The warning to print, or `null` when the library will load. */
export function localLibraryWarning({
  outDir = DEFAULT_OUT_DIR,
  bucket = process.env.VITE_FIREBASE_STORAGE_BUCKET,
} = {}) {
  if (bucket?.trim()) return null;
  if (existsSync(join(outDir, PACK_INDEX_KEY))) return null;
  return [
    "warning: the sound library has not been built, so the library browser will",
    'show "This library is unavailable." Run `bun run library:build` once, then',
    `restart the dev server. See ${LOCAL_LIBRARY_DOCS}.`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const warning = localLibraryWarning();
  if (warning) console.warn(`\x1b[33m${warning}\x1b[0m`);
}
