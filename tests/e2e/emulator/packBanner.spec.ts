import {
  library,
  newProjectOnInstrumentView,
  openPadSlot,
  projectPacks,
  railButton,
  soundList,
} from "./support/library";
import { expect, type Page, test } from "./support/test";

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
  await expect(
    library(page).getByRole("region", { name: "Packs", exact: true }),
  ).toHaveCount(0);
  await expect(soundList(page).getByRole("listitem").first()).toBeVisible();
}

test.describe("pack banner", () => {
  test("Back to all sounds from a pack opened under Browse packs", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await railButton(page, "Browse packs").click();
    await library(page)
      .getByRole("button", { name: /^Open / })
      .first()
      .click();

    await backToAllSounds(page);
  });

  test("Back to all sounds from a pack opened in the rail", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await railButton(page, "Browse packs").click();
    await projectPacks(page).getByRole("button").first().click();

    await backToAllSounds(page);
  });

  // #1011: opening a pack from the grid, or leaving it from the banner, took
  // the focused control away and left focus on <body>.
  test("keeps focus when a pack opens from the grid and when it is left", async ({
    page,
  }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await railButton(page, "Browse packs").click();
    await library(page)
      .getByRole("button", { name: /^Open / })
      .first()
      .click();

    const banner = library(page).getByRole("region", { name: /^About / });
    await expect(banner).toBeFocused();

    await banner.getByRole("button", { name: "Back to all sounds" }).click();
    await expect(banner).toHaveCount(0);
    await expect(railButton(page, "All sounds")).toBeFocused();
  });

  test("keeps focus when the keyboard opens a pack and leaves it with Enter", async ({
    page,
  }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await railButton(page, "Browse packs").click();
    await library(page)
      .getByRole("button", { name: /^Open / })
      .first()
      .focus();
    await page.keyboard.press("Enter");

    const banner = library(page).getByRole("region", { name: /^About / });
    await expect(banner).toBeFocused();

    await banner.getByRole("button", { name: "Back to all sounds" }).focus();
    await page.keyboard.press("Enter");
    await expect(banner).toHaveCount(0);
    await expect(railButton(page, "All sounds")).toBeFocused();
  });
});
