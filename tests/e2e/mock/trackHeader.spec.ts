import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The arrangement's header column and the instrument view's rail are one
 * component (#447), and switching between the two views must not move a
 * track: measured from the first header, so whatever each view puts above its
 * rows (a ruler, a heading, a toolbar) is not part of the claim, every header
 * and everything inside it lands on the same pixels. Only a real layout can say
 * so, so it is asserted here.
 */
type Rect = readonly [x: number, y: number, width: number, height: number];

async function rects(headers: Locator): Promise<Rect[][]> {
  return headers.evaluateAll((rows) =>
    rows.map((row) =>
      [
        row,
        ...row.querySelectorAll(
          ".track-header-swatch, .track-header-select, .mute-solo-toggle, .fill-slider-track, .level-meter-horizontal",
        ),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height] as const;
      }),
    ),
  );
}

/** Every rect's y measured from the first header's top, so a different amount
 * of chrome above the rows does not count as a difference between the views. */
function fromFirstHeader(rows: Rect[][]): Rect[][] {
  const top = rows[0]?.[0]?.[1] ?? 0;
  return rows.map((row) =>
    row.map(([x, y, width, height]) => [x, y - top, width, height] as const),
  );
}

async function toView(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name })
    .click();
}

test("a track header sits on the same pixels in the arrangement and the rail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByTestId("arrangement-view-ready")).toBeVisible();
  await page.getByRole("button", { name: "Add synth track" }).click();
  const headers = page.locator("[data-track-drag]");
  await expect(headers).toHaveCount(2);

  const arrangement = await rects(headers);

  await toView(page, "Instrument");
  await expect(page.getByRole("list", { name: "Tracks" })).toBeVisible();
  const rail = await rects(headers);

  expect(fromFirstHeader(rail)).toEqual(fromFirstHeader(arrangement));
});

test("a track header's volume follows a pointer drag, in both views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByTestId("arrangement-view-ready")).toBeVisible();

  for (const view of ["Arrangement", "Instrument"]) {
    await toView(page, view);
    const fader = page.getByRole("slider", { name: /^Volume for / }).first();
    await expect(fader).toBeVisible();
    const box = await fader.boundingBox();
    if (!box) throw new Error("the fader has no box");
    const y = box.y + box.height / 2;
    // Grab near the right end and drag in steps to the left: a drag, not a
    // click, and every step an edit that must not rebuild the row under it.
    await page.mouse.move(box.x + box.width * 0.9, y);
    await page.mouse.down();
    for (const at of [0.8, 0.6, 0.4, 0.2]) {
      await page.mouse.move(box.x + box.width * at, y, { steps: 3 });
    }
    await page.mouse.up();
    expect(Number(await fader.inputValue())).toBeLessThan(0.35);
  }
});
