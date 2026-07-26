import { expect, test } from "@playwright/test";

// PRD `OPS-01` post-deploy smoke test. Runs against `SMOKE_URL` (the real
// deployed Firebase Hosting URL) with real Firebase Authentication and
// Firestore -- see playwright.smoke.config.ts. A failing run here is treated
// as a failed deploy: the `deploy` job in .github/workflows/ci.yml runs this
// immediately after `firebase deploy` and does not consider the deploy
// successful until it passes.
//
// This intentionally does not reuse e2e/smoke.spec.ts: that suite drives the
// in-memory mock backend (`VITE_MOCK_BACKEND=true`) against a local dev
// server, which proves the UI works but nothing about whether the deployed
// build can actually reach production Firebase Authentication, Firestore, and
// security rules.
test.describe("hosted alpha smoke test", () => {
	test("loads, starts an anonymous session, opens a project, and starts audio after a gesture", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Groove" })).toBeVisible();

		// Anonymous session start (Firebase Authentication, not the mock).
		await page.getByRole("button", { name: "Start creating" }).click();
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

		// Project open. The hosted alpha has no seeded project for a fresh
		// anonymous identity (that is Phase 1's starter-template work), so the
		// smoke test creates one -- this also proves the Firestore write path
		// and security rules work end to end, not just the read path.
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/[^/]+$/);

		// Audio start after a user gesture (autoplay policies require one).
		const playButton = page.getByRole("button", { name: "Start playback" });
		await expect(playButton).toBeVisible();
		await playButton.click();
		await expect(
			page.getByRole("button", { name: "Stop playback" }),
		).toBeVisible();
	});
});
