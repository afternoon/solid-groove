import { expect, test } from "@playwright/test";

// FND-001's isolated example for the browser E2E suite. It exercises the
// "anonymous start" journey from PRD section 14's required end-to-end test
// layer: landing page -> anonymous session -> dashboard, all against the
// in-memory mock backend (see playwright.config.ts).
test.describe("landing page", () => {
	test("shows the product pitch and entry actions", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByRole("heading", { name: "Groove" })).toBeVisible();
		await expect(
			page.getByText(
				"Your collaborative, AI-assisted, browser-based music studio.",
			),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Start creating" }),
		).toBeVisible();
	});
});

test.describe("anonymous start", () => {
	test("starting creates an anonymous session and lands on the dashboard", async ({
		page,
	}) => {
		await page.goto("/");

		await page.getByRole("button", { name: "Start creating" }).click();

		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
		// The mock data service seeds one project for any signed-in user.
		await expect(
			page.getByRole("link", { name: "My First Groove" }),
		).toBeVisible();
	});
});
