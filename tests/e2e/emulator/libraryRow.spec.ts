import { expect, type Locator, test } from "@playwright/test";
import { openBdSlot, soundList } from "./support/libraryModal";

// #812: the pointer is still over a sound row right after it is clicked to
// select it. The global `button:hover` fill then landed on the row's main
// button, dark grey under the selected row's black text. `docs/design.md`: a
// bright fill carries dark text, so the selected row stays one white band
// whether or not the pointer is over it, and an unselected row's hover lights
// the whole row rather than only its main button. Asserted in a real browser,
// because only a real cascade says which fill is painted under the pointer.

/** The colour the browser resolved for one property of one element. */
const resolved = (locator: Locator, property: "backgroundColor" | "color") =>
  locator.evaluate((element, key) => getComputedStyle(element)[key], property);

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test.describe("library sound rows", () => {
  test("the selected row stays one white band under the pointer", async ({ page }) => {
    await openBdSlot(page);
    const rows = soundList(page).getByRole("listitem");
    await expect(rows.nth(1)).toBeVisible();

    const row = rows.nth(1);
    const main = row.getByRole("button", { name: /^Audition / });
    await main.click();
    await expect(main).toHaveAttribute("aria-pressed", "true");
    await main.hover();

    // The row's own fill shows through its main button, and the text on it is
    // the dark accent text, so the pair stays readable.
    await expect.poll(() => resolved(main, "backgroundColor")).toBe(TRANSPARENT);
    const fill = await resolved(row, "backgroundColor");
    const text = await resolved(main, "color");
    const accent = await page.evaluate(() => {
      const probe = document.createElement("span");
      const root = getComputedStyle(document.documentElement);
      probe.style.color = root.getPropertyValue("--color-accent").trim();
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    expect(fill).toBe(accent);
    expect(text).not.toBe(accent);

    // Its icons step down from white under the pointer, never to the dark fill.
    const similar = row.getByRole("button", { name: /^Sounds like / });
    await similar.hover();
    await expect
      .poll(async () => {
        const [r, g, b] = (await resolved(similar, "backgroundColor"))
          .match(/\d+/g)
          ?.map(Number) ?? [0, 0, 0];
        return Math.min(r, g, b);
      })
      .toBeGreaterThan(128);
  });

  test("hovering an unselected row lights the whole row", async ({ page }) => {
    await openBdSlot(page);
    const row = soundList(page).getByRole("listitem").nth(2);
    const main = row.getByRole("button", { name: /^Audition / });
    await expect(main).toHaveAttribute("aria-pressed", "false");
    await main.hover();

    await expect.poll(() => resolved(row, "backgroundColor")).not.toBe(TRANSPARENT);
    await expect.poll(() => resolved(main, "backgroundColor")).toBe(TRANSPARENT);
  });
});
