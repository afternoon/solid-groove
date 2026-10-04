import { expect, test } from "@playwright/test";
import {
  library,
  newProjectOnInstrumentView,
  openPadSlot,
  soundList,
} from "./support/library";

// #880: the library left focus where it was while the arrow keys moved the
// selection, so a screen reader never named the selected sound and Tab walked
// every row and its icon buttons. Focus now follows the selection onto the
// selected row's main button, and the list is one Tab stop. Asserted in a real browser, because only a real one
// moves focus with Tab.

test.describe("library focus", () => {
  test("follows the arrow keys, and Tab leaves the list in one press", async ({
    page,
  }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    const rows = soundList(page).getByRole("listitem");
    await expect(rows.nth(1)).toBeVisible();

    // The library is a view (UI-002): it does not take focus into its search
    // field, so 1-5 and Enter keep working the moment it opens.
    await expect(
      library(page).getByRole("searchbox", { name: "Search sounds" }),
    ).not.toBeFocused();

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
