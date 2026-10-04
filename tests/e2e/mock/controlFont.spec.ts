import { expect, type Locator, type Page, test } from "@playwright/test";

// #811: form controls do not inherit `font-family`, so without an explicit
// rule every button and input renders in the browser's default face (Arial in
// Chromium) beside body text set in the UI stack. The `?font=` override (#787)
// only reaches them through the same rule, so both are pinned here: in a real
// browser, because only a real cascade says which face a control resolves to.

/** The `font-family` the browser resolved for one element. */
const fontOf = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => getComputedStyle(element).fontFamily);

const bodyFont = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).fontFamily);

/** The dashboard's rename form shows a button and a text input together. */
async function openRename(page: Page): Promise<{ button: Locator; input: Locator }> {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  // A client-side return keeps the in-memory project (see smoke.spec.ts).
  await page.getByRole("link", { name: /projects/i }).click();
  await page.getByRole("button", { name: /rename/i }).click();
  return {
    button: page.getByRole("button", { name: /^save$/i }),
    input: page.getByRole("textbox", { name: /^Rename / }),
  };
}

test.describe("control font", () => {
  test("buttons and inputs use the UI font, not the browser default", async ({
    page,
  }) => {
    const { button, input } = await openRename(page);
    const body = await bodyFont(page);

    expect(body).toContain("system-ui");
    expect(await fontOf(button)).toBe(body);
    expect(await fontOf(input)).toBe(body);
  });

  test("the ?font= override reaches buttons and inputs", async ({ page }) => {
    // Never fetch from Google in a test: the face need not load for the
    // resolved family to name it.
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await page.goto("/projects?font=Inter");
    const { button, input } = await openRename(page);

    expect(await fontOf(button)).toContain("Inter");
    expect(await fontOf(input)).toContain("Inter");
  });
});
