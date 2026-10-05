import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "../../../playwright.chromium";
import { SESSION_FILE, SPECS_DIR, SWEEP_URL } from "./paths";

// The scheduled QA sweep's harness (#859, `.github/workflows/qa-sweep.yml`).
// An agent explores the live app by writing throwaway specs into `SPECS_DIR`
// and running them under this config. Like `../playwright.config.ts` it drives
// the real deployed build on real Firebase, so it touches production; the
// three projects below are what keep that to the sweep's own data:
//
//   session  signs the agent in as its QA account, `testuser<QA_SWEEP_SLOT>`
//            (#1055, only if no session exists yet), and records the session,
//            with its IndexedDB, in `SESSION_FILE`. It needs the
//            `QA_SIGN_IN_SERVICE_ACCOUNT` secret (`../qaSession.ts`);
//   explore  the agent's specs, every one of them signed in as that account;
//   cleanup  deletes every project that account owns. The workflow runs it
//            after the agent finishes, whatever the agent did.
//
// Run it as `bunx playwright test --config=tests/e2e/hosted/qa-sweep/playwright.config.ts
// --project=explore` (which runs `session` first) and `--project=cleanup`.
export default defineConfig({
  outputDir: "../../../../test-results/qa-sweep",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: SWEEP_URL,
    launchOptions: chromiumLaunchOptions,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "session", testDir: ".", testMatch: /session\.sweep\.ts$/ },
    {
      name: "explore",
      testDir: SPECS_DIR,
      testMatch: /\.spec\.ts$/,
      dependencies: ["session"],
      use: { storageState: SESSION_FILE },
    },
    { name: "cleanup", testDir: ".", testMatch: /cleanup\.sweep\.ts$/ },
  ],
});
