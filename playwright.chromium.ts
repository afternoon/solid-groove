import type { LaunchOptions } from "@playwright/test";

/**
 * Launch options for every Chromium project across this repo's Playwright
 * configs.
 *
 * Empty by default, which is what CI and a local machine want: Playwright
 * resolves the browser it downloaded for its own pinned revision. It is only
 * non-empty when `PW_CHROMIUM_PATH` says the environment supplies a Chromium
 * build of its own — a container that preinstalls one at a revision this
 * repo's `@playwright/test` pin does not ask for, so Playwright's own lookup
 * misses a binary that is sitting right there. `.claude/hooks/session-start.sh`
 * sets it for Claude Code on the web.
 *
 * Deliberately Chromium-only. Firefox and WebKit have no equivalent override
 * because no environment we run in preinstalls them, and CI — which installs
 * the browser it is testing — is where those two are gating. See
 * `docs/testing.md`, "Which browsers run where".
 */
export const chromiumLaunchOptions: LaunchOptions = process.env.PW_CHROMIUM_PATH
	? { executablePath: process.env.PW_CHROMIUM_PATH }
	: {};
