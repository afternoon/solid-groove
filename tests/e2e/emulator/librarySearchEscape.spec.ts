import {
  library,
  newProjectOnInstrumentView,
  openPadSlot,
  soundList,
} from "./support/library";
import { expect, type Locator, type Page, test } from "./support/test";
import { expectView } from "./support/views";

// #877: Escape in the library's search field left the library, and the slot
// went back to its previous sound. Escape from the field clears a query,
// keeping focus in the field. Since #817 the library is a view, which Escape
// never leaves (a view key does), so an empty field, or focus anywhere else,
// leaves both the library and the query as they are. Asserted in a real
// browser, because a `type="search"` field has a native Escape of its own.

const search = (page: Page): Locator =>
  library(page).getByRole("searchbox", { name: "Search sounds" });

async function typeQuery(page: Page, text: string): Promise<void> {
  await search(page).click();
  await page.keyboard.type(text);
  await expect(search(page)).toHaveValue(text);
}

test.describe("library search Escape", () => {
  test("Escape clears a query in the field and stays in the library", async ({
    page,
  }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await typeQuery(page, "kick");

    await page.keyboard.press("Escape");

    await expect(library(page)).toBeVisible();
    await expect(search(page)).toHaveValue("");
    await expect(search(page)).toBeFocused();

    await page.keyboard.press("Escape");

    await expectView(page, "Library");
    await expect(library(page)).toBeVisible();
  });

  test("Escape keeps the query when focus has left the field", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await typeQuery(page, "k");
    await expect(soundList(page).getByRole("listitem").first()).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(search(page)).not.toBeFocused();
    await page.keyboard.press("Escape");

    await expectView(page, "Library");
    await expect(search(page)).toHaveValue("k");
  });
});
