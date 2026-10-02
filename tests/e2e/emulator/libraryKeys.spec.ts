import { expect, type Page, test } from "@playwright/test";
import {
  backToInstrument,
  library,
  newProjectOnInstrumentView,
  openPadSlot,
  railButton,
  readout,
  slotSound,
  soundList,
} from "./support/library";
import { expectView } from "./support/views";

// #860: the library's Enter (insert) and Space (audition again) let the
// browser's default run too, so the focused button was pressed as well.
// Asserted in a real browser, because only a real one turns a key into a click
// on whatever is focused.
//
// Since #817 the library is the view on `4`, and Enter inserts and stays there
// so another sound can be tried: the insert shows as the sound in the slot,
// and the library is still the view you are on.

/** Select the second sound in the list with the keyboard, as a producer would. */
async function selectSecondSound(page: Page): Promise<string> {
  await expect(soundList(page).getByRole("listitem").nth(1)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const hearing = (await readout(page, "Hearing").textContent()) ?? "";
  return hearing.replace(/^Hearing/, "").trim();
}

/** The insert landed, and the library is still the view you are on. */
async function expectInsertedAndStayed(page: Page, name: string): Promise<void> {
  await expect(readout(page, "In the slot")).toContainText(name);
  await page.waitForTimeout(300);
  await expectView(page, "Library");
  await backToInstrument(page);
  await expect.poll(() => slotSound(page, "BD")).toBe(name);
}

test.describe("library keys", () => {
  test("Enter inserts the selected sound and the library stays", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    const name = await selectSecondSound(page);

    await page.keyboard.press("Enter");

    await expectInsertedAndStayed(page, name);
  });

  test("Enter on a clicked row inserts it and the library stays", async ({ page }) => {
    await newProjectOnInstrumentView(page);
    await openPadSlot(page, "BD");
    const row = soundList(page)
      .getByRole("button", { name: /^Audition / })
      .nth(2);
    const name = ((await row.getAttribute("aria-label")) ?? "").replace(/^Audition /, "");
    await row.click();

    await page.keyboard.press("Enter");

    await expectInsertedAndStayed(page, name);
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
    const before = (await readout(page, "In the slot").textContent()) ?? "";

    await railButton(page, "Browse packs").focus();
    await page.keyboard.press("Enter");

    await expect(railButton(page, "Browse packs")).toHaveAttribute("aria-current", /.+/);
    await expect(library(page)).toBeVisible();
    await expect(readout(page, "In the slot")).toHaveText(before);
  });
});
