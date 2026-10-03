import { expect, type Locator, type Page, test } from "@playwright/test";
import { library, openBdSlot, soundList } from "./support/libraryModal";

// #877: Escape in the library's search field closed the whole library, and the
// slot went back to its previous sound. Escape from the field clears a query
// first, keeping the library open and focus in the field; an empty field, or
// focus anywhere else, still closes it. Asserted in a real browser, because a
// `type="search"` field has a native Escape of its own.

const search = (page: Page): Locator =>
  library(page).getByRole("searchbox", { name: "Search sounds" });

async function typeQuery(page: Page, text: string): Promise<void> {
  await search(page).click();
  await page.keyboard.type(text);
  await expect(search(page)).toHaveValue(text);
}

test.describe("library search Escape", () => {
  test("Escape clears a query in the field, then closes the library", async ({
    page,
  }) => {
    await openBdSlot(page);
    await typeQuery(page, "kick");

    await page.keyboard.press("Escape");

    await expect(library(page)).toBeVisible();
    await expect(search(page)).toHaveValue("");
    await expect(search(page)).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(library(page)).toBeHidden();
  });

  test("Escape closes the library when focus has left the field", async ({ page }) => {
    await openBdSlot(page);
    await typeQuery(page, "k");
    await expect(soundList(page).getByRole("listitem").first()).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(search(page)).not.toBeFocused();
    await page.keyboard.press("Escape");

    await expect(library(page)).toBeHidden();
  });
});
