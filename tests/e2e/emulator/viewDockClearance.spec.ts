import { expect, type Locator, type Page, test } from "./support/test";
import { dock, expectView, pressView } from "./support/views";

/**
 * GRV-62: the floating view dock never sits over a control the editor has just
 * scrolled to. Selecting the Mixer's Master strip scrolls its effects into
 * view; it used to bring their foot to the window's bottom edge, which is
 * where the dock floats, so the Delay's lower Division options lay under the
 * dock and a click meant for them switched views instead.
 *
 * Every click here goes to the point on screen, as a pointer would, never
 * through Playwright's own scroll-into-view: that scrolls the page for you and
 * would hide the very thing under test. Whether the dock is on top is layout
 * and hit-testing, which jsdom does not do.
 */

/**
 * What a pointer would hit at the centre of `target`, as the page stands:
 * `"target"` when it is the control itself, `"off-screen"` when the centre is
 * outside the window, else a description of what is in the way.
 */
async function hitAtCentre(target: Locator): Promise<string> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (y < 0 || y >= window.innerHeight || x < 0 || x >= window.innerWidth) {
      return "off-screen";
    }
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === element || element.contains(hit))) return "target";
    const inDock = hit?.closest("nav[aria-label='Views']");
    if (inDock) return "the view dock";
    return hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : "nothing";
  });
}

/** Clicks the centre of `target` where it is now, without scrolling first. */
async function clickInPlace(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("the target has no box on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("the view dock's clearance", () => {
  test("the Mixer's Master Delay divisions are clickable without scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByTestId("arrangement-view-ready").waitFor();

    await pressView(page, "Mixer");
    const masterStrip = page.getByRole("button", { name: "Master", exact: true });
    await expect(masterStrip).toBeVisible();
    expect(await hitAtCentre(masterStrip)).toBe("target");
    await clickInPlace(page, masterStrip);

    const master = page.getByRole("region", { name: "Master effects" });
    const addDelay = master.getByRole("button", { name: "Add delay device" });
    await expect(addDelay).toBeVisible();
    await expect.poll(() => hitAtCentre(addDelay)).toBe("target");
    await clickInPlace(page, addDelay);

    const division = master.getByRole("group", { name: "Division" });
    await expect(division).toBeVisible();
    const options = ["1/8 dotted", "1/4", "1/2"] as const;
    // What the pointer meets at each option, as the page settled after adding.
    const hits: Record<string, string> = {};
    // An option is its label: the radio inside it is visually hidden.
    const optionLabel = (label: string): Locator =>
      division.locator("label", { has: page.getByRole("radio", { name: label }) });
    for (const label of options) {
      hits[label] = await hitAtCentre(optionLabel(label));
    }
    expect(hits, "what a click on each lower Division option lands on").toEqual(
      Object.fromEntries(options.map((label) => [label, "target"])),
    );

    for (const label of options) {
      await clickInPlace(page, optionLabel(label));
      await expect(division.getByRole("radio", { name: label })).toBeChecked();
      await expectView(page, "Mixer");
    }
    await expect(dock(page)).toBeVisible();
  });
});
