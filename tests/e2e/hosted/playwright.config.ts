import { defineConfig, devices } from "@playwright/test";

// PRD `OPS-01` post-deploy smoke test: "the app loads, an anonymous session
// starts, a project opens, and audio starts after a user gesture ... a failed
// smoke test is treated as a failed deploy." This runs against the real
// hosted Hosting URL with real Firebase Authentication/Firestore, never the
// in-memory mock backend `playwright.config.ts`'s suite uses -- see
// docs/testing.md "Deploy" for how the `deploy` CI job wires this in.
//
// SMOKE_URL is the origin the deployed build is served from -- the public one
// visitors reach (`site.config.mjs`'s `SITE_ORIGIN`, https://groove.ben2.com),
// which is what the `deploy` job passes. The Firebase-issued
// `https://<project-id>.web.app` subdomain still serves the same build, and is
// the one to pass by hand when isolating Hosting from DNS.
//
// There is no local/mock fallback: this suite has nothing to verify without a
// real deployed build, unlike `e2e/`.
const baseURL = process.env.SMOKE_URL;

if (!baseURL) {
  throw new Error(
    "tests/e2e/hosted/playwright.config.ts: SMOKE_URL must be set to the deployed site's origin " +
      '(e.g. SMOKE_URL="https://groove.ben2.com" bun run smoke:hosted).',
  );
}

export default defineConfig({
  testDir: ".",
  // Test artifacts stay at the repo root even though this config now lives in
  // `tests/`: Playwright resolves both paths relative to the config file, and
  // CI uploads `playwright-report/` from the root (see .github/workflows/ci.yml)
  // while `bun run clean` removes the root copies.
  outputDir: "../../../test-results",
  // One worker: this hits a real, rate-limited backend rather than a local
  // dev server, and the suite is small enough that serial execution costs
  // nothing.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // Chromium only. This is a post-deploy health check, not the
  // cross-browser compatibility suite -- that is `test:browser`'s job.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
