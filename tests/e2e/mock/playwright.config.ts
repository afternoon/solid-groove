import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "../../playwright.chromium";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

// Browser E2E suite. `bun run test:browser` runs the PRD section 10 P0
// gating browsers — Firefox, and the branded Chrome and Edge builds through
// Playwright's `chrome`/`msedge` channels (#75) — plus Playwright's own
// Chromium, which is what an environment that can install nothing else runs
// as its pre-flight, and WebKit as a non-gating signal: it always runs, but
// CI treats a WebKit-only failure as a warning rather than a blocker (see
// .github/workflows/ci.yml). A channel resolves to the *current* stable
// release installed on the machine; Playwright cannot pin the previous major,
// so that half of "current and previous" is the manual checklist's
// (docs/runbooks/cross-browser.md).
//
// Playwright drives the app against the in-memory mock backend
// (`VITE_DEV_BACKEND=mock`, see src/projectRepositoryClient.ts and
// src/auth/authService.ts) rather than a real Firebase project, so this
// suite has no external dependency and needs no emulator. `page.reload()`
// cannot be used to prove persistence here — the in-memory repository is a
// fresh, empty store every page load — see tests/e2e/emulator/playwright.config.ts.
export default defineConfig({
  testDir: ".",
  // Test artifacts stay at the repo root even though this config now lives in
  // `tests/`: Playwright resolves both paths relative to the config file, and
  // CI uploads `playwright-report/` from the root (see .github/workflows/ci.yml)
  // while `bun run clean` removes the root copies.
  outputDir: "../../../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "../../../playwright-report" }],
      ]
    : "list",
  // The suite runs against the dev server, so the first test to reach a route
  // pays for compiling that route's chunks on demand — the dashboard pulls in
  // the Firebase SDK, which is measurably slow the first time. Cold locally
  // that leaves the anonymous-start assertion at ~4.8s against Playwright's 5s
  // default, i.e. passing by 200ms and certain to tip over on a slower runner.
  // Give assertions real headroom; it costs nothing when they pass promptly.
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    // `--host 127.0.0.1` pins the dev server to IPv4. Without it vinxi binds
    // whatever `localhost` resolves to, and on a dual-stack host (GitHub
    // runners resolve localhost to both 127.0.0.1 and ::1) that can be the
    // IPv6 address while `url` below polls IPv4 — the server comes up, nothing
    // ever answers on 127.0.0.1, and the run dies on the webServer timeout.
    command: "bun run dev --host 127.0.0.1",
    // Playwright resolves `cwd` relative to this config file, which now lives
    // under `tests/`. The dev server must run from the repo root.
    cwd: "../../..",
    // `port`, not `url`. Solid 2's start mode only serves the document shell to
    // **HTML-accepting** GETs and 404s everything else (by design -- see
    // `@solidjs/vite-plugin`'s client mode). Playwright's `url` probe sends a
    // bare GET, so it read that 404 as "not up yet" and sat here until the
    // webServer timeout even though the server was serving fine. `port` waits
    // on the TCP listener instead, which is what "the dev server is up"
    // actually means. A real browser always sends `Accept: text/html`, so this
    // only ever affected the probe.
    port: PORT,
    reuseExistingServer: !process.env.CI,
    // A cold start takes a few seconds locally, but CI runners are slower and
    // build from an empty Vite cache, so allow real headroom.
    timeout: 120_000,
    // Vinxi's startup banner and any boot error go to stdout, which Playwright
    // discards by default — a webServer timeout is then unattributable from the
    // CI log alone. Pipe it so the next failure explains itself.
    stdout: "pipe",
    stderr: "pipe",
    env: {
      VITE_DEV_BACKEND: "mock",
    },
  },
  // Running one browser is a legitimate thing to do — `bun run
  // test:browser:chromium` is the pre-flight in an environment that can only
  // install Chromium — but it is a pre-flight, not this suite. Firefox is
  // gating and only CI runs all three. See docs/testing.md, "Which browsers
  // run where".
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumLaunchOptions,
      },
    },
    // Branded Chrome and Edge (#75): Chromium underneath, but each ships its
    // own media stack, codecs and autoplay policy, which is what PRD section
    // 10 gates on. Neither takes `chromiumLaunchOptions`: a channel is the
    // installed browser, never a supplied Chromium build.
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
