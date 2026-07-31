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

// `LOOP-001`: the dashboard's project-management surface — blank creation,
// rename, duplicate, and confirmed delete — against the in-memory mock
// backend. See `e2e-emulator/dashboard.spec.ts` for the access-control and
// persisted-delete coverage a real backend is needed to prove.
test.describe("dashboard project management", () => {
	test("creates a genuinely empty project via Blank Project", async ({
		page,
	}) => {
		await page.goto("/dashboard");

		await page.getByRole("button", { name: "Blank Project" }).click();

		await expect(page).toHaveURL(/\/projects\/prj_/);
		await expect(
			page.getByText("This project has no sampler track yet."),
		).toBeVisible();
	});

	test("renames, duplicates, and deletes a project from the dashboard", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		// Return to the dashboard via the editor's client-side "Projects" link,
		// NOT page.goto("/dashboard"). A full page load would drop the in-memory
		// mock store (see playwright.config.ts), losing the project just created;
		// the router link keeps the same page alive so the new project is listed.
		await page.getByRole("link", { name: /projects/i }).click();
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByText("Untitled Project")).toBeVisible();

		// Rename.
		await page.getByRole("button", { name: /rename/i }).click();
		await page
			.getByRole("textbox", { name: /rename untitled project/i })
			.fill("My First Groove");
		await page.getByRole("button", { name: /^save$/i }).click();
		await expect(page.getByText("My First Groove")).toBeVisible();
		await expect(page.getByText("Untitled Project")).not.toBeVisible();

		// Duplicate: an independent second project appears alongside it.
		await page.getByRole("button", { name: /duplicate/i }).click();
		await expect(page.getByText("My First Groove copy")).toBeVisible();
		await expect(
			page.getByText("My First Groove", { exact: true }),
		).toBeVisible();

		// Delete requires confirmation. Only the duplicate's card is targeted
		// (its text is a superset of the original's, so filtering on the full
		// "... copy" text is what tells the two cards apart).
		const duplicateCard = page
			.locator(".project-card")
			.filter({ hasText: "My First Groove copy" });
		await duplicateCard.getByRole("button", { name: /^delete$/i }).click();
		const dialog = page.getByRole("alertdialog", {
			name: /delete this project/i,
		});
		await expect(dialog).toBeVisible();

		// Cancelling keeps it.
		await dialog.getByRole("button", { name: /^cancel$/i }).click();
		await expect(page.getByText("My First Groove copy")).toBeVisible();

		// Confirming removes only that one.
		await duplicateCard.getByRole("button", { name: /^delete$/i }).click();
		await page
			.getByRole("alertdialog", { name: /delete this project/i })
			.getByRole("button", { name: /^delete$/i })
			.click();
		await expect(page.getByText("My First Groove copy")).not.toBeVisible();
		await expect(
			page.getByText("My First Groove", { exact: true }),
		).toBeVisible();
	});
});
