import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { assistantButton, newProject, panel, panelButton } from "./support/assistant";
import { soundList } from "./support/library";
import { pressView, type ViewName } from "./support/views";

/**
 * The automated half of the accessibility pass (#76): axe-core over every
 * surface the issue names (the dashboard, the editor's five views, the
 * shortcut guide, the assistant and the Export dialog), each in the state a
 * producer first meets it. The manual half, the keyboard and screen-reader
 * scripts axe cannot run, is `docs/accessibility.md`.
 *
 * The bar is WCAG 2.1 A and AA plus axe's best practices (heading order,
 * landmarks, scrollable regions). WCAG 2.2's 24px target size is not in it:
 * the editor is a dense instrument panel by design (docs/design.md), and that
 * trade is the accessibility doc's to explain, not this check's to waive one
 * control at a time.
 *
 * A failure names the rule and the elements, so the fix starts from the
 * message rather than from a re-run with a debugger.
 */

const STANDARD = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/** Run axe over the page as it stands, and fail with what it found. */
async function expectAccessible(page: Page, surface: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
  const found = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
        .map((node) => `    ${node.target.join(" ")}`)
        .join("\n")}`,
  );
  expect(found, `${surface} has accessibility violations`).toEqual([]);
}

const VIEWS: readonly ViewName[] = ["Sequence", "Instrument", "Library", "Mixer"];

test.describe("accessibility (axe)", { tag: "@sanity" }, () => {
  test("the dashboard, empty, listing a project, and confirming a delete", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(page.getByText("No projects yet")).toBeVisible();
    await expectAccessible(page, "the empty dashboard");

    await newProject(page);
    await page.goto("/projects");
    const remove = page.getByRole("button", { name: /^Delete / }).first();
    await expect(remove).toBeVisible();
    await expectAccessible(page, "the dashboard");

    await remove.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectAccessible(page, "the delete confirmation");
  });

  test("the editor's five views", async ({ page }) => {
    await newProject(page);
    await expectAccessible(page, "the arrangement");
    for (const view of VIEWS) {
      await pressView(page, view);
      // The library lists its sounds once the pack index has loaded.
      if (view === "Library") {
        await expect(soundList(page).getByRole("listitem").first()).toBeVisible();
      }
      await expectAccessible(page, `the ${view.toLowerCase()} view`);
    }
  });

  test("the shortcut guide, the assistant and the Export dialog", async ({ page }) => {
    await newProject(page);

    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await expectAccessible(page, "the shortcut guide");
    await page.keyboard.press("Escape");

    await assistantButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expectAccessible(page, "the floating assistant");
    await panelButton(page, "Dock to the right").click();
    await expectAccessible(page, "the docked assistant");
    await panelButton(page, "Close").click();
    await expect(panel(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Export", exact: true })).toBeVisible();
    await expectAccessible(page, "the Export dialog");
  });
});
