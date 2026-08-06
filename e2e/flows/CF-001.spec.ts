import { expect, test } from "@playwright/test";
import { walkthrough } from "../support/walkthrough";

/**
 * `CF-001` — a visitor with no account reaches a playing loop.
 *
 * This is the worked example for the core-flow convention: read
 * `docs/core-flows.md` for the flow this reproduces, and copy this file's shape
 * when writing a new one. Three properties are what make it a *flow* spec
 * rather than an ordinary E2E test:
 *
 *  - It starts at an entrypoint a person could actually arrive at — the public
 *    landing page — and never deep-links into seeded state. That is what makes
 *    the captured walkthrough worth a reviewer's time.
 *  - Its steps are the register's numbered steps, one `step()` caption each, in
 *    the same order and the same words. When they diverge, the register is
 *    right and this file is wrong.
 *  - It asserts the outcome the register promises, and stops. Neighbouring
 *    behavior is covered at the lowest useful layer, not bolted on here — a
 *    flow spec that grows assertions becomes a flow nobody can read.
 *
 * This one is not `test.fixme` because the behavior it describes already
 * shipped (`FND-009`, `LOOP-001b`, `LOOP-010`). A flow written for work that
 * has *not* shipped lands as `test.fixme` in the first PR of its stack, and the
 * PR that closes the issue removes the marker in the same diff that makes it
 * pass.
 *
 * Runs against the in-memory mock backend (see `playwright.config.ts`), which
 * is a fresh, empty store on every page load — so this flow deliberately proves
 * nothing about persistence. `e2e-emulator/` is where that belongs.
 */
test.describe("CF-001", () => {
	test("a visitor with no account reaches a playing loop", async ({ page }) => {
		const step = walkthrough(page, {
			id: "CF-001",
			title: "A visitor with no account reaches a playing loop",
		});

		// 1. Open the landing page.
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
		).toBeVisible();
		await step("Open the landing page");

		// 2. Choose to start in your browser.
		await page.getByRole("button", { name: "Start in your browser" }).click();

		// 3. You arrive at the dashboard, signed in as a guest, with no projects.
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
		await expect(page.getByText(/You're working as a guest/)).toBeVisible();
		await expect(page.getByText("No projects yet")).toBeVisible();
		await step("You arrive at the dashboard as a guest, with no projects yet");

		// 4. Create a new project.
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		// 5. It opens on a step editor already carrying a starter pattern.
		await expect(
			page.getByRole("region", { name: "Step editor" }),
		).toBeVisible();
		// The starter project's four-on-the-floor clip: steps 1, 5, 9, 13 on. Two
		// of them, plus an off step, so this cannot pass against an empty grid.
		await expect(
			page.getByRole("button", { name: "Notes, step 1, on" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Notes, step 5, on" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Notes, step 2, off" }),
		).toBeVisible();
		await step("The new project opens on a step editor with a starter pattern");

		// 6. Turn on a step that was off.
		await page.getByRole("button", { name: "Notes, step 2, off" }).click();
		await expect(
			page.getByRole("button", { name: "Notes, step 2, on" }),
		).toBeVisible();
		await step("Turn on a step that was off");

		// 7. Start playback.
		//
		// The transport is what this asserts — that the button flips to its
		// playing state, which only happens once `useProjectAudio.play()` has
		// resumed the shared AudioRuntime and started the transport. It is NOT an
		// assertion that a sound reached a speaker: a headless browser records no
		// audio and Playwright captures none. See docs/core-flows.md's "Out of
		// scope" for this flow, docs/testing.md, and issue #43.
		await page.getByRole("button", { name: "Start playback" }).click();
		await expect(
			page.getByRole("button", { name: "Stop playback" }),
		).toBeVisible();
		await step("Start playback — the transport is running");
	});
});
