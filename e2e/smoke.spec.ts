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
		// The in-memory repository starts empty; a project only exists once
		// created (see the "new project" test below).
		await expect(page.getByText("No projects yet")).toBeVisible();
	});
});

// `FND-009`: the foundation vertical slice's surface — a 16-step grid on a
// sampler track — reachable end to end from an anonymous session. This suite
// runs against the in-memory mock backend (see playwright.config.ts), which
// is a fresh store on every page load, so it cannot prove persistence across
// a real reload; e2e-emulator/slice.spec.ts covers that against a real
// (emulated) backend instead.
test.describe("new project", () => {
	test("creates a project with a working 16-step sampler grid", async ({
		page,
	}) => {
		await page.goto("/dashboard");

		await page.getByRole("button", { name: "New Project" }).click();

		await expect(page).toHaveURL(/\/projects\/prj_/);
		const grid = page.getByRole("group", { name: "16-step sequence" });
		await expect(grid).toBeVisible();
		// The starter project's four-on-the-floor clip: steps 1, 5, 9, 13 on.
		await expect(
			page.getByRole("button", { name: "Step 1, on" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Step 2, off" }),
		).toBeVisible();

		// Toggling a step dispatches through the command layer and is visible
		// immediately.
		await page.getByRole("button", { name: "Step 2, off" }).click();
		await expect(
			page.getByRole("button", { name: "Step 2, on" }),
		).toBeVisible();

		// Undo reverts it through the same shared history the toggle used.
		await page.getByRole("button", { name: /^Undo/ }).click();
		await expect(
			page.getByRole("button", { name: "Step 2, off" }),
		).toBeVisible();
	});
});
