import { expect, type Locator, type Page, test } from "@playwright/test";

// The editor's layout in a real browser: the sequence view fills the page, the
// Export dialog's scrim stays clear under the pointer, and the arrangement
// shell stays inside its panel. jsdom has no layout, so only a browser can say
// any of it. Moved here from the retired mock-backend suite's `smoke.spec.ts`;
// that file's step-editor test is CF-001's step 7 plus `slice.spec.ts`'s
// keyboard undo in the sequence view, so it was not carried over.

/** One bar at 192 PPQ. */
const TICKS_PER_BAR = 4 * 192;

/**
 * The vertical middle of the first track row, read off the arrangement root
 * rather than copied here — the row height moved from 28 to 84 and every copy
 * of it went on passing, because the old centre still landed inside the taller
 * row. The horizontal scale was already read this way.
 */
async function firstRowCentreY(ready: Locator): Promise<number> {
  const rulerHeight = Number(await ready.getAttribute("data-ruler-height"));
  const rowHeight = Number(await ready.getAttribute("data-row-height"));
  expect(rowHeight).toBeGreaterThan(0);
  return rulerHeight + rowHeight / 2;
}

/** Opens the first row's clip the way a producer does — a double-click on the
 * timeline (`UI-001`). A clip is canvas pixels, reachable only as a point. */
async function openStarterClip(page: Page): Promise<Locator> {
  const ready = page.getByTestId("arrangement-view-ready");
  await expect(ready).toBeVisible();
  const pixelsPerTick = Number(await ready.getAttribute("data-pixels-per-tick"));
  await page.locator(".arrangement-layer-interactive").dblclick({
    position: {
      x: (TICKS_PER_BAR / 2) * pixelsPerTick,
      y: await firstRowCentreY(ready),
    },
  });
  const editor = page.getByRole("region", { name: "Sequence editor" });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("editor layout", () => {
  // UI-002: the sequence view is the whole body under the header, running to
  // the bottom of the window as the arrangement does. Only a real layout can
  // say so.
  test("fills the page with the sequence view", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    const editor = await openStarterClip(page);

    const box = await editor.boundingBox();
    expect(box).not.toBeNull();
    const { x, width, height } = box as NonNullable<typeof box>;
    expect(width).toBeGreaterThan(1440 - 2 * 8);
    expect(x).toBeLessThan(8);
    expect(height).toBeGreaterThan(900 * 0.8);
  });

  // The dialog shell: the scrim stays clear under the pointer (app.css's global
  // `button:hover` fill used to win). The sequence view's contents start where
  // its title does.
  test("keeps the scrim clear on hover and aligns content with the title", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await page.getByTestId("arrangement-view-ready").waitFor();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();

    await page.mouse.move(20, 450);
    await expect(page.locator(".dialog-scrim")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await page.keyboard.press("Escape");
    const editor = await openStarterClip(page);

    const title = await editor.locator(".sequence-editor-title").boundingBox();
    const body = await editor.locator(".sequence-editor-body").boundingBox();
    expect(Math.abs((body?.x ?? -1) - (title?.x ?? -99))).toBeLessThanOrEqual(1);
  });

  // `ARR-001`: the arrangement shell stays inside the panel it is given. Real
  // layout is the only place this can be proved — jsdom has no layout, so a
  // shell that overflowed its panel would look fine to the component tests
  // while silently covering its neighbours and swallowing their clicks.
  test("keeps the arrangement shell inside its panel", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);

    const shell = page.getByTestId("arrangement-view-ready");
    await expect(shell).toBeVisible();

    const panelBox = await page.locator(".arrangement-panel").boundingBox();
    const shellBox = await shell.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(shellBox).not.toBeNull();
    if (!panelBox || !shellBox) return;

    // The shell fills its panel and stops there.
    expect(shellBox.height).toBeLessThanOrEqual(panelBox.height + 1);
    expect(shellBox.y + shellBox.height).toBeLessThanOrEqual(
      panelBox.y + panelBox.height + 1,
    );
    // Sequencing is a modal now (UI-001): nothing is stacked beneath it.
    await expect(page.getByRole("region", { name: "Step editor" })).toHaveCount(0);
  });
});
