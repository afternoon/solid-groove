import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../support/walkthrough";

/**
 * `CF-003` — a producer names and rearranges the parts of their song.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for the section-editing
 * half of `ARR-003` (#61) — CF-002 covers the template-driven half — and is
 * frozen once it lands.
 *
 * `test.fixme` because section markers do not exist yet. Unlike CF-002, this
 * flow depends on nothing outside `ARR-003`: step 1 uses the placement
 * duplication `ARR-002` already shipped, so every selector before the first
 * section is added is a real one read off the built UI.
 *
 * What it proves that CF-002 does not: that a section is a handle on a range of
 * the timeline, so moving one carries the music inside it. That is the
 * `ARR-02` acceptance criterion with a visible consequence — a section reorder
 * that left its placements behind would still look correct on the ruler.
 */

/** The arrangement's DOM mirror of what is selected (`ArrangementView.tsx`). */
const selectedPlacements = (page: Page): Locator =>
	page.getByTestId("placement-selection").locator("li");

/**
 * The sections on the ruler, in order. Their order in the DOM is the order they
 * sit on the timeline, which is what step 5 reads.
 */
const sections = (page: Page): Locator =>
	page.getByRole("list", { name: "Sections" }).getByRole("listitem");

test.describe("CF-003", () => {
	test.fixme(
		"a producer names and rearranges the parts of their song",
		async ({ page }) => {
			const step = walkthrough(page, {
				id: "CF-003",
				title: "A producer names and rearranges the parts of their song",
			});

			// 1. Create a new project and duplicate its placement further along the
			//    timeline, so there are two distinct parts to label.
			await page.goto("/dashboard");
			await page.getByRole("button", { name: "New Project" }).click();
			await expect(page).toHaveURL(/\/projects\/prj_/);
			await page.getByTestId("arrangement-view-ready").waitFor();

			await page
				.getByRole("button", { name: /^Select / })
				.first()
				.click();
			await expect(selectedPlacements(page)).toHaveCount(1);
			await page
				.getByRole("button", { name: /^Duplicate as a linked copy/ })
				.click();
			await expect(selectedPlacements(page)).toHaveCount(1);
			await step("A project with two parts on the timeline");

			// 2. Add a section over the first part and name it "Intro".
			await page.getByRole("button", { name: "Add section" }).click();
			await page.getByRole("textbox", { name: "Section name" }).fill("Intro");
			await page.getByRole("textbox", { name: "Section name" }).press("Enter");
			await expect(sections(page)).toHaveCount(1);
			await expect(sections(page).first()).toContainText("Intro");
			await step('Add a section over the first part and name it "Intro"');

			// 3. Add a section over the second part, name it "Drop", and give it a
			//    different colour.
			await page.getByRole("button", { name: "Add section" }).click();
			await page.getByRole("textbox", { name: "Section name" }).fill("Drop");
			await page.getByRole("textbox", { name: "Section name" }).press("Enter");
			await page.getByRole("button", { name: "Section colour" }).click();
			await page.getByRole("option", { name: "Orange" }).click();
			await expect(sections(page)).toHaveCount(2);
			await step('Add a "Drop" over the second part, in a different colour');

			// 4. Move "Drop" ahead of "Intro".
			await page
				.getByRole("listitem")
				.filter({ hasText: "Drop" })
				.getByRole("button", { name: "Move section earlier" })
				.click();
			await step('Move "Drop" ahead of "Intro"');

			// 5. The two sections swap places on the ruler, and the placements
			//    inside each one travel with it.
			//
			// Both halves matter. The ruler order is the visible half; the
			// placement that moved with the section is the half a reorder could
			// silently get wrong, so it is asserted through the arrangement's own
			// selection mirror rather than by eye.
			await expect(sections(page).first()).toContainText("Drop");
			await expect(sections(page).nth(1)).toContainText("Intro");
			await page
				.getByRole("button", { name: "Select the placements in Drop" })
				.click();
			await expect(selectedPlacements(page)).toHaveCount(1);
			await expect(
				page.getByTestId("arrangement-selection-live"),
			).toContainText("bars 1 to 1");
			await step("The sections swap, and their clips travel with them");

			// 6. Undo once.
			//
			// One reorder is one transaction, so a single undo restores both the
			// section order and the placements that moved with it.
			await page.getByRole("button", { name: /^Undo/ }).click();
			await expect(sections(page).first()).toContainText("Intro");
			await expect(sections(page).nth(1)).toContainText("Drop");
			await step("Undo once — the order is back");
		},
	);
});
