import { expect, type Page, test } from "@playwright/test";
import {
  library,
  newProjectOnInstrumentView,
  openPadSlot,
  railButton,
  readout,
  sampleSlot,
  soundList,
} from "./support/library";

// #860: the library's Enter (insert) and Space (audition again) let the
// browser's default run too, so the focused button was pressed as well. Enter
// inserted, then the slot button that focus returned to took the Enter and
// opened the library again; Space pressed the Close button the library parks
// focus on, and closed it. Asserted in a real browser, because only a real one
// turns a key into a click on whatever is focused.

/** Select the second sound in the list with the keyboard, as a producer would. */
async function selectSecondSound(page: Page): Promise<string> {
  await expect(soundList(page).getByRole("listitem").nth(1)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const hearing = (await readout(page, "Hearing").textContent()) ?? "";
  return hearing.replace(/^Hearing/, "").trim();
}

test.describe("library keys", () => {
  test("Enter inserts the selected sound and the library stays closed", async ({
    page,
  }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    const name = await selectSecondSound(page);

    await page.keyboard.press("Enter");

    await expect(sampleSlot(page, "BD")).toContainText(name);
    await page.waitForTimeout(300);
    await expect(library(page)).toBeHidden();
  });

  test("Enter on a clicked row inserts it and the library stays closed", async ({
    page,
  }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    const row = soundList(page)
      .getByRole("button", { name: /^Audition / })
      .nth(2);
    const name = ((await row.getAttribute("aria-label")) ?? "").replace(/^Audition /, "");
    await row.click();

    await page.keyboard.press("Enter");

    await expect(sampleSlot(page, "BD")).toContainText(name);
    await page.waitForTimeout(300);
    await expect(library(page)).toBeHidden();
  });

  test("Space auditions again and leaves the library open", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await selectSecondSound(page);

    await page.keyboard.press("Space");

    await page.waitForTimeout(300);
    await expect(library(page)).toBeVisible();
  });

  test("a focused rail button keeps Enter for itself", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    await selectSecondSound(page);
    const before = await sampleSlot(page, "BD").textContent();

    await railButton(page, "Browse packs").focus();
    await page.keyboard.press("Enter");

    await expect(railButton(page, "Browse packs")).toHaveAttribute("aria-current", /.+/);
    await expect(library(page)).toBeVisible();
    expect(await sampleSlot(page, "BD").textContent()).toBe(before);
  });
});
