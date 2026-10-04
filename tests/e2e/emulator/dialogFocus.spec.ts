import { expect, type Locator, type Page, test } from "@playwright/test";

// #876: the library took focus on open, but nothing kept it there. Shift+Tab
// from its search field walked out to the editor behind the scrim ("Add reverb
// device", "Add delay device", ...), where a keyboard could press controls it
// could not see. Asserted in a real browser, because only a real one says
// where Tab goes once the rest of the app is `inert`.
//
// The library has since become a view (#817), not a dialog, so this holds the
// same line on the editor's remaining modal, the Export dialog.

const exportDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Export", exact: true });

/** A new project with the Export dialog open over it. */
async function openExport(page: Page): Promise<void> {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByTestId("arrangement-view-ready").waitFor();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(exportDialog(page)).toBeVisible();
}

/**
 * Where focus is: inside the dialog, on nothing (the browser's own chrome,
 * between the last control and the first), or somewhere behind it.
 */
const focusPlace = (page: Page): Promise<"inside" | "nowhere" | string> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "nowhere";
    if (active.closest('[role="dialog"][aria-label="Export"]')) return "inside";
    return (
      active.getAttribute("aria-label") ?? active.textContent?.trim() ?? active.tagName
    );
  });

test.describe("dialog focus", () => {
  test("Shift+Tab from the dialog's first control stays inside", async ({ page }) => {
    await openExport(page);
    const first = exportDialog(page).getByRole("button", { name: "Close export" });
    await first.focus();

    await page.keyboard.press("Shift+Tab");
    expect(await focusPlace(page)).toMatch(/^(inside|nowhere)$/);

    // And all the way round in both directions: nothing behind the scrim is
    // ever reached, and Tab comes back into the dialog.
    for (const key of ["Shift+Tab", "Tab"]) {
      await first.focus();
      let wentInside = false;
      for (let presses = 0; presses < 60; presses += 1) {
        await page.keyboard.press(key);
        const place = await focusPlace(page);
        expect(place, `${key} #${presses + 1} reached ${place}`).toMatch(
          /^(inside|nowhere)$/,
        );
        if (place === "inside") wentInside = true;
      }
      expect(wentInside).toBe(true);
    }

    // The editor behind it cannot be clicked or read either.
    const editorInert = await page.evaluate(
      () => document.querySelector('[aria-label="Views"]')?.closest("[inert]") != null,
    );
    expect(editorInert).toBe(true);
  });

  test("the editor is live again once the dialog closes", async ({ page }) => {
    await openExport(page);
    await exportDialog(page).getByRole("button", { name: "Close export" }).click();
    await expect(exportDialog(page)).toBeHidden();

    await expect(page.locator("[inert]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
  });
});
