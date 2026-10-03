import { expect, type Page, test } from "@playwright/test";
import {
  library,
  openBdSlot,
  railButton,
  readout,
  sampleSlot,
  soundList,
} from "./support/libraryModal";

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
    await openBdSlot(page);
    const name = await selectSecondSound(page);

    await page.keyboard.press("Enter");

    await expect(sampleSlot(page)).toContainText(name);
    await page.waitForTimeout(300);
    await expect(library(page)).toBeHidden();
  });

  test("Enter on a clicked row inserts it and the library stays closed", async ({
    page,
  }) => {
    await openBdSlot(page);
    const row = soundList(page)
      .getByRole("button", { name: /^Audition / })
      .nth(2);
    const name = ((await row.getAttribute("aria-label")) ?? "").replace(/^Audition /, "");
    await row.click();

    await page.keyboard.press("Enter");

    await expect(sampleSlot(page)).toContainText(name);
    await page.waitForTimeout(300);
    await expect(library(page)).toBeHidden();
  });

  test("Space auditions again and leaves the library open", async ({ page }) => {
    await openBdSlot(page);
    await selectSecondSound(page);

    await page.keyboard.press("Space");

    await page.waitForTimeout(300);
    await expect(library(page)).toBeVisible();
  });

  // #961: a held key auto-repeats, and each repeat of a shortcut that does not
  // repeat was ignored without suppressing its default, so the browser pressed
  // the focused button anyway. Playwright's second `keyboard.down` of a key
  // still down is a `repeat: true` keydown, just like an OS auto-repeat.
  test("held Space auditions the selection and never presses a focused button", async ({
    page,
  }) => {
    await openBdSlot(page);
    // A clicked row keeps focus while the arrows move the selection on.
    const rows = soundList(page).getByRole("button", { name: /^Audition / });
    await rows.nth(0).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const selected = (await readout(page, "Hearing").textContent()) ?? "";

    await page.keyboard.down(" ");
    await page.keyboard.down(" ");
    await page.keyboard.down(" ");
    await page.keyboard.up(" ");

    await page.waitForTimeout(300);
    await expect(library(page)).toBeVisible();
    await expect(readout(page, "Hearing")).toHaveText(selected);
  });

  test("held Space with focus on Close leaves the library open", async ({ page }) => {
    await openBdSlot(page);
    await selectSecondSound(page);

    await page.keyboard.down(" ");
    await page.keyboard.down(" ");
    await page.keyboard.up(" ");

    await page.waitForTimeout(300);
    await expect(library(page)).toBeVisible();
  });

  test("a focused rail button keeps Enter for itself", async ({ page }) => {
    await openBdSlot(page);
    await selectSecondSound(page);
    const before = await sampleSlot(page).textContent();

    await railButton(page, "Browse packs").focus();
    await page.keyboard.press("Enter");

    await expect(railButton(page, "Browse packs")).toHaveAttribute("aria-current", /.+/);
    await expect(library(page)).toBeVisible();
    expect(await sampleSlot(page).textContent()).toBe(before);
  });
});
