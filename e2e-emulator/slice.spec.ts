import { expect, test } from "@playwright/test";

/**
 * `FND-009` — the foundation vertical slice, exercised against a real
 * (emulated) backend: open a schema-v1 project, add one note, play it, undo
 * it, save it, reload it, and reproduce playback.
 *
 * Runs against the Firestore + Auth emulator (see `playwright.emulator.config.ts`),
 * not the in-memory mock backend `e2e/smoke.spec.ts` uses — the mock
 * repository is a fresh, empty store on every page load, so it cannot prove
 * anything survives a real `page.reload()`.
 */
test.describe("foundation vertical slice", () => {
	test("add a note, play it, undo it, save it, and reload it", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
		await expect(page.getByText("No projects yet")).toBeVisible();

		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);
		const projectUrl = page.url();

		const grid = page.getByRole("group", { name: "16-step sequence" });
		await expect(grid).toBeVisible();
		// The starter project's four-on-the-floor clip: steps 1, 5, 9, 13 on.
		await expect(
			page.getByRole("button", { name: "Step 1, on" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Step 3, off" }),
		).toBeVisible();

		// The reopened project must report the same pack dependency it saved
		// (PRD LIB-05, invariant 12) — visible as soon as the starter project
		// loads, since its sampler asset resolves through a pack from the start.
		const packLabel = page.getByText(/^Pack: pak_/);
		await expect(packLabel).toBeVisible();
		const packDependencyText = await packLabel.textContent();

		// Add a note: dispatches note.add through the shared command layer.
		await page.getByRole("button", { name: "Step 3, off" }).click();
		await expect(
			page.getByRole("button", { name: "Step 3, on" }),
		).toBeVisible();

		// Play it: the allowed user gesture resumes the shared AudioRuntime and
		// starts the transport.
		const transportToggle = page.getByRole("button", {
			name: "Start playback",
		});
		await transportToggle.click();
		await expect(
			page.getByRole("button", { name: "Stop playback" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Stop playback" }).click();

		// Undo it: the added note is removed through the same history.
		await page.getByRole("button", { name: /^Undo/ }).click();
		await expect(
			page.getByRole("button", { name: "Step 3, off" }),
		).toBeVisible();

		// Save it: the autosave status settles once the revision-checked write
		// against the emulator completes.
		await expect(page.locator(".save-status")).toHaveText("Saved", {
			timeout: 10_000,
		});

		// Reload it: a genuine browser reload, answered by the emulator rather
		// than by in-memory state the reload just discarded.
		await page.reload();
		await expect(page).toHaveURL(projectUrl);
		await expect(
			page.getByRole("button", { name: "Step 1, on" }),
		).toBeVisible();
		// The undone note stayed undone — a stale echo of the pre-undo save
		// never got the chance to restore it, and the reload reads the
		// post-undo revision that was actually persisted.
		await expect(
			page.getByRole("button", { name: "Step 3, off" }),
		).toBeVisible();
		await expect(page.getByText(packDependencyText ?? "")).toBeVisible();

		// Reproduce playback after reload, against the stable graph rebuilt
		// from the reloaded project.
		await page.getByRole("button", { name: "Start playback" }).click();
		await expect(
			page.getByRole("button", { name: "Stop playback" }),
		).toBeVisible();
	});
});
