import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The arrangement's header column and the instrument view's rail are one
 * component (#447), and switching between the two views must not move a
 * track: less the arrangement's toolbars, which the instrument view does not
 * have, every header and everything inside it lands on the same pixels. Only
 * a real layout can say so, so it is asserted here.
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
  // What the arrangement has above its rows that the instrument view does not.
  const toolbars = await page.evaluate(() => {
    const view = document.querySelector(".arrangement-view")?.getBoundingClientRect();
    const body = document.querySelector(".arrangement-body")?.getBoundingClientRect();
    return (body?.y ?? 0) - (view?.y ?? 0);
  });
  expect(toolbars).toBeGreaterThan(0);

  await toView(page, "Instrument");
  await expect(page.getByRole("list", { name: "Tracks" })).toBeVisible();
  const rail = await rects(headers);

  const shifted = arrangement.map((row) =>
    row.map(([x, y, width, height]) => [x, y - toolbars, width, height] as const),
  );
  expect(rail).toEqual(shifted);
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

// A lifted header (#539) is a fixed copy. Appended inside a transformed or
// will-change ancestor (the arrangement's scrolling header column) "fixed"
// resolves against that ancestor, so the copy drew offset from the pointer.
test("a lifted track header keeps its grab point under the pointer, in both views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByTestId("arrangement-view-ready")).toBeVisible();
  for (const name of ["Add synth track", "Add synth track"]) {
    await page.getByRole("button", { name }).click();
  }
  await expect(page.locator("[data-track-drag]")).toHaveCount(3);

  for (const view of ["Arrangement", "Instrument"]) {
    await toView(page, view);
    const header = page.locator("[data-track-drag]").nth(1);
    const box = await header.boundingBox();
    if (!box) throw new Error("the header has no box");
    const [gx, gy] = [box.width - 6, 5];
    const grab = { x: box.x + gx, y: box.y + gy };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (const [dx, dy] of [
      [0, 10],
      [-8, 40],
      [-30, 70],
    ]) {
      await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 3 });
      const copy = await page.locator(".drag-lift").boundingBox();
      if (!copy) throw new Error("no lifted copy");
      expect(Math.abs(copy.x - (grab.x + dx - gx)), `${view} x`).toBeLessThanOrEqual(2);
      expect(Math.abs(copy.y - (grab.y + dy - gy)), `${view} y`).toBeLessThanOrEqual(2);
    }
    await page.mouse.up();
  }
});

// Where a header shows the grab cursor, a press must lift it; where it cannot
// (the fader's track), it must not. The fader's label and the gaps around its
// parts are header, not fader.
test("a track header lifts from anywhere it shows the grab hand, and not from its fader", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByTestId("arrangement-view-ready")).toBeVisible();
  await page.getByRole("button", { name: "Add synth track" }).click();

  const lifts = async (at: { x: number; y: number }): Promise<boolean> => {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 4, at.y + 30, { steps: 4 });
    const lifted = (await page.locator(".drag-lift").count()) > 0;
    await page.mouse.up();
    return lifted;
  };

  for (const view of ["Arrangement", "Instrument"]) {
    await toView(page, view);
    const header = page.locator("[data-track-drag]").first();
    const box = await header.boundingBox();
    const label = await header.locator(".fill-slider-label").boundingBox();
    const track = await header.locator(".fill-slider-track").boundingBox();
    if (!box || !label || !track) throw new Error("the header is missing a part");
    const points = {
      "left padding": { x: box.x + 3, y: box.y + box.height / 2 },
      "top padding": { x: box.x + box.width / 2, y: box.y + 2 },
      "the fader label": { x: label.x + label.width / 2, y: label.y + label.height / 2 },
      "right of the fader label": {
        x: label.x + label.width + 2,
        y: label.y + label.height / 2,
      },
      "just below the name": { x: box.x + box.width / 2, y: box.y + 22 },
    };
    for (const [where, at] of Object.entries(points)) {
      expect(await lifts(at), `${view}: ${where}`).toBe(true);
    }
    const fader = { x: track.x + track.width / 2, y: track.y + track.height / 2 };
    expect(await lifts(fader), `${view}: the fader's track`).toBe(false);
  }
});
