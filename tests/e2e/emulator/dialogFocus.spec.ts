import { expect, type Locator, type Page, test } from "@playwright/test";

// #876: the library took focus on open, but nothing kept it there. Shift+Tab
// from its search field walked out to the editor behind the scrim ("Add reverb
// device", "Add delay device", ...), where a keyboard could press controls it
// could not see. Asserted in a real browser, because only a real one says
// where Tab goes once the rest of the app is `inert`.

const library = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Library", exact: true });

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
  await drums.getByRole("button", { name: "Sample for BD", exact: true }).click();
  await expect(library(page)).toBeVisible();
}

/**
 * Where focus is: inside the library, on nothing (the browser's own chrome,
 * between the last control and the first), or somewhere behind it.
 */
const focusPlace = (page: Page): Promise<"inside" | "nowhere" | string> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "nowhere";
    if (active.closest('[role="dialog"][aria-label="Library"]')) return "inside";
    return (
      active.getAttribute("aria-label") ?? active.textContent?.trim() ?? active.tagName
    );
  });

test.describe("dialog focus", () => {
  test("Shift+Tab from the library's first control stays inside", async ({ page }) => {
    await openBdSlot(page);
    const search = library(page).getByRole("searchbox", { name: "Search sounds" });
    await search.focus();

    await page.keyboard.press("Shift+Tab");
    expect(await focusPlace(page)).toMatch(/^(inside|nowhere)$/);

    // And all the way round in both directions: nothing behind the scrim is
    // ever reached, and Tab comes back into the library.
    for (const key of ["Shift+Tab", "Tab"]) {
      await search.focus();
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
      () =>
        document.querySelector('[aria-label="Drum machine: BD"]')?.closest("[inert]") !=
        null,
    );
    expect(editorInert).toBe(true);
  });

  test("the editor is live again once the library closes", async ({ page }) => {
    await openBdSlot(page);
    await library(page).getByRole("button", { name: "Close library" }).click();
    await expect(library(page)).toBeHidden();

    await expect(page.locator("[inert]")).toHaveCount(0);
    const slot = page
      .getByRole("region", { name: "Drum machine: BD" })
      .getByRole("button", { name: "Sample for BD", exact: true });
    await expect(slot).toBeFocused();
  });
});
