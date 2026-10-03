import { expect, type Page, test } from "@playwright/test";
import { library, openBdSlot, railButton, soundList } from "./support/libraryModal";

// #875: an opened pack's banner close, "Back to all sounds", landed on the
// Browse packs grid with "Browse packs" current, whichever way the pack was
// opened. It has to leave the pack for All sounds.

/** Press the open pack's banner close and check All sounds is where it lands. */
async function backToAllSounds(page: Page): Promise<void> {
  const banner = library(page).getByRole("region", { name: /^About / });
  await banner.getByRole("button", { name: "Back to all sounds" }).click();

  await expect(banner).toHaveCount(0);
  await expect(railButton(page, "All sounds")).toHaveAttribute("aria-current", "true");
  await expect(railButton(page, "Browse packs")).not.toHaveAttribute("aria-current");
  await expect(library(page).getByRole("region", { name: "Packs" })).toHaveCount(0);
  await expect(soundList(page).getByRole("listitem").first()).toBeVisible();
}

test.describe("pack banner", () => {
  test("Back to all sounds from a pack opened under Browse packs", async ({ page }) => {
    await openBdSlot(page);
    await railButton(page, "Browse packs").click();
    await library(page)
      .getByRole("button", { name: /^Open / })
      .first()
      .click();

    await backToAllSounds(page);
  });

  test("Back to all sounds from a pack opened in the rail", async ({ page }) => {
    await openBdSlot(page);
    await railButton(page, "Browse packs").click();
    await library(page)
      .getByRole("group", { name: "In this project" })
      .getByRole("button")
      .first()
      .click();

    await backToAllSounds(page);
  });
});
