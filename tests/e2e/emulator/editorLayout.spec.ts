import { expect, type Locator, type Page, test } from "./support/test";

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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Two boxes share some area (touching edges do not count). */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

// #1031: the editor header's right-hand controls (undo/redo, Assistant,
// Export, `?` and the account control) stay whole, on screen, and clear of
// each other and of the transport at the narrow widths producers use. At
// ~800px the right-hand zone was held to half the spare width, so its buttons
// were squeezed to a bare cell and their labels ran over each other and off
// the right edge ("Assista", "Expor", "Sign ou").
test.describe("editor header at narrow widths", () => {
  for (const width of [768, 800, 1024]) {
    test(`keeps every header control whole and on screen at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/projects");
      await page.getByRole("button", { name: "New Project" }).click();
      await page.getByTestId("arrangement-view-ready").waitFor();

      const header = page.locator(".editor-header");
      const account = header.getByRole("button", { name: "Sign out" });
      await expect(account).toBeVisible();
      const controls = {
        transport: header.locator(".editor-header-center"),
        history: header.locator(".editor-header-end .header-cell-group"),
        assistant: header.getByRole("button", { name: "Assistant" }),
        export: header.getByRole("button", { name: "Export", exact: true }),
        guide: header.getByRole("button", { name: "Keyboard shortcuts" }),
        account,
      };
      // A worded button holds its whole label: nothing spills past its edge.
      const spilled = await header
        .locator(".editor-header-end button")
        .evaluateAll((buttons) =>
          buttons
            .filter((button) => button.scrollWidth > button.clientWidth)
            .map((button) => button.textContent?.trim() || button.className),
        );
      expect(spilled, "header buttons whose label overflows them").toEqual([]);
      const boxes: Record<string, Box> = {};
      for (const [name, locator] of Object.entries(controls)) {
        const box = await locator.boundingBox();
        expect(box, `${name} has a box`).not.toBeNull();
        boxes[name] = box as Box;
      }
      for (const [name, box] of Object.entries(boxes)) {
        expect(box.x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${name} ends on screen`).toBeLessThanOrEqual(width);
      }
      const names = Object.keys(boxes);
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          expect(
            overlaps(boxes[names[i]], boxes[names[j]]),
            `${names[i]} clear of ${names[j]}`,
          ).toBe(false);
        }
      }
      // The project's side gives way, but keeps room for some of the name.
      // Its zone is measured rather than the name, which is as long as the
      // random starter name is.
      const start = await header.locator(".editor-header-start").boundingBox();
      expect(start?.width ?? 0, "project zone width").toBeGreaterThanOrEqual(110);
      // Still a real click target: the button is the topmost thing at its centre.
      const a = boxes.account;
      const hit = await page.evaluate(
        ([x, y]) =>
          document.elementFromPoint(x, y)?.closest("button")?.textContent ?? null,
        [a.x + a.width / 2, a.y + a.height / 2],
      );
      expect(hit).toBe("Sign out");
    });
  }
});
