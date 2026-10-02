import { expect, type Locator, type Page, test } from "@playwright/test";

// #880: the library parked focus on its Close button and left it there while
// the arrow keys moved the selection, so a screen reader never named the
// selected sound and Tab walked every row and its icon buttons. The library now
// opens in its search field, focus follows the selection onto the selected
// row's main button, and the list is one Tab stop. Asserted in a real browser,
// because only a real one moves focus with Tab.

// Like `libraryRow.spec.ts`, this walks today's UI with its own setup: the
// shared `./support/library` helpers describe the #817 views the parked core
// flows are written against. When #817 lands, this setup moves onto them.
const library = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Library", exact: true });
const soundList = (page: Page): Locator =>
  library(page).getByRole("list", { name: "Sounds", exact: true });

/** A new project, its "BD" pad's sample slot pressed, and the library open. */
async function openBdSlot(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByTestId("arrangement-view-ready").waitFor();
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: "Instrument" })
    .click();
  const drums = page.getByRole("region", { name: "Drum machine: BD" });
  await drums.getByRole("button", { name: "Audition BD", exact: true }).click();
  await drums.getByRole("button", { name: "Sample for BD", exact: true }).click();
  await expect(library(page)).toBeVisible();
}

test.describe("library focus", () => {
  test("opens in search, follows the arrow keys, and Tab leaves the list in one press", async ({
    page,
  }) => {
    await openBdSlot(page);
    const rows = soundList(page).getByRole("listitem");
    await expect(rows.nth(1)).toBeVisible();

    await expect(
      library(page).getByRole("searchbox", { name: "Search sounds" }),
    ).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    const second = rows.nth(1).locator(".sound-row-main");
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(second).toBeInViewport();

    await page.keyboard.press("Tab");

    await expect
      .poll(() =>
        soundList(page).evaluate((list) => list.contains(document.activeElement)),
      )
      .toBe(false);
    await expect(library(page)).toBeVisible();
  });
});
