#!/usr/bin/env node
//
// Fails the build when the deployed client bundle carries no Firebase client
// configuration.
//
// Why this exists: `src/firebaseConfig.ts` reads `import.meta.env.VITE_FIREBASE_*`
// and falls back to `undefined` outside mock mode, so a build with those
// variables unset succeeds, passes `verify:bundle`, and deploys cleanly -- and
// then every Auth call fails in the browser with `auth/invalid-api-key`,
// rendering the app's error boundary instead of the page. That happened on
// d65077c: the deploy job reported success and shipped an app that could not
// start a session. Only the post-deploy smoke test caught it, after the broken
// build was already live.
//
// A missing build-time constant is a build defect, not a runtime one, so it
// should fail before `firebase deploy` runs rather than after. This runs in
// `predeploy` (see package.json), between `build` and `verify:bundle`.
//
// Deliberately narrow: it asserts the *presence and shape* of values Vite
// inlined into the bundle. It cannot tell a valid API key from a revoked one --
// that is the post-deploy smoke test's job, and the two are complementary.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BUILD_DIR = ".output/public";

// Only the fields whose absence breaks app startup. `databaseURL` (unused, the
// project has no Realtime Database) and `measurementId` (analytics-only, and
// the app degrades cleanly without it) are deliberately not required.
const REQUIRED = [
  { key: "apiKey", pattern: /^AIza[\w-]{35}$/ },
  { key: "authDomain", pattern: /\.firebaseapp\.com$/ },
  { key: "projectId", pattern: /^[a-z0-9-]+$/ },
  { key: "appId", pattern: /^\d+:\d+:web:[a-f0-9]+$/ },
];

function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collectJsFiles(path));
    else if (entry.endsWith(".js")) out.push(path);
  }
  return out;
}

let files;
try {
  files = collectJsFiles(BUILD_DIR);
} catch {
  console.error(
    `verify-client-config: cannot read "${BUILD_DIR}". Run \`bun run build\` first.`,
  );
  process.exit(1);
}

// Vite inlines `import.meta.env.X` as a literal, so the built config object
// reads `apiKey:"AIza..."` when set and `apiKey:void 0` when not. Scan every
// chunk: which one holds the config depends on how the bundler split it.
const haystack = files.map((f) => readFileSync(f, "utf8")).join("\n");

const failures = [];
for (const { key, pattern } of REQUIRED) {
  const match = haystack.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`));
  if (!match) {
    failures.push(
      `${key}: not present in the bundle (built as \`undefined\` -- VITE_FIREBASE_${key
        .replace(/([A-Z])/g, "_$1")
        .toUpperCase()} was unset at build time)`,
    );
  } else if (!pattern.test(match[1])) {
    failures.push(`${key}: present but malformed (does not match ${pattern})`);
  }
}

if (failures.length > 0) {
  console.error(
    `verify-client-config: the built client in "${BUILD_DIR}" has no usable Firebase configuration.\n`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nThis build would deploy successfully and then fail in the browser with\n" +
      "`auth/invalid-api-key`. Set the VITE_FIREBASE_* variables on the `prod`\n" +
      'GitHub environment (see docs/testing.md "Deploy"), then rebuild.\n' +
      "Note that a job only receives an environment's variables if it declares\n" +
      "`environment: prod`.",
  );
  process.exit(1);
}

console.log(
  `verify-client-config: Firebase client configuration present in "${BUILD_DIR}".`,
);
