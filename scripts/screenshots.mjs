#!/usr/bin/env node
/**
 * `bun run screenshots -- <spec>...`: capture `step()` screenshots from any
 * spec in the emulator browser suite (`tests/e2e/emulator/`), in Chromium, one
 * worker at a time.
 *
 * A wrapper rather than a one-line `package.json` script because the suite has
 * to run *inside* `firebase emulators:exec`, whose command is one quoted
 * string: arguments appended after `--` would land on `emulators:exec`, not on
 * Playwright. This puts them inside the string instead. See docs/testing.md,
 * "PR screenshots".
 */
import { spawnSync } from "node:child_process";

const quote = (arg) => `'${arg.replaceAll("'", `'\\''`)}'`;

const playwright = [
  "playwright test",
  "--config=tests/e2e/emulator/playwright.config.ts",
  "--project=chromium",
  "--workers=1",
  ...process.argv.slice(2).map(quote),
].join(" ");

const result = spawnSync(
  "firebase",
  [
    "emulators:exec",
    "--only",
    "firestore,auth,storage",
    "--project",
    "demo-solid-groove",
    playwright,
  ],
  { stdio: "inherit", env: { ...process.env, CAPTURE_WALKTHROUGH: "1" } },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
