import { expect, test } from "./support/test";

/**
 * GRV-66: the Projects page fits a phone-width screen (390x844). Each row's
 * Rename, Duplicate and Delete sit inside the viewport without any sideways
 * scroll, of the page or of the list, and the "Projects" heading reads in full
 * rather than disappearing under the header's buttons.
 *
 * jsdom cannot lay anything out, so this lives in the browser suite.
 */
test.describe("projects list at phone width", () => {
  test("rows and heading fit a 390px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    const name = (await page.locator("h1.project-name").textContent())?.trim() ?? "";
    expect(name).not.toBe("");

    await page.goto("/projects");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // No sideways scroll: neither the document nor the list's own box.
    const overflow = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".project-list");
      return {
        document:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        list: list ? list.scrollWidth - list.clientWidth : 0,
      };
    });
    expect.soft(overflow).toEqual({ document: 0, list: 0 });

    // Every row action lies wholly inside the 390px viewport.
    for (const action of ["Rename", "Duplicate", "Delete"]) {
      const box = await row
        .getByRole("button", { name: `${action} ${name}`, exact: true })
        .boundingBox();
      expect(box, action).not.toBeNull();
      expect.soft(box?.x ?? -1, action).toBeGreaterThanOrEqual(0);
      expect.soft((box?.x ?? 0) + (box?.width ?? 0), action).toBeLessThanOrEqual(390);
    }

    // The heading is inside the viewport and no header control covers it.
    const heading = page.getByRole("heading", { name: "Projects", exact: true });
    const covered = await heading.evaluate((h1) => {
      const title = h1.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(h1);
      const text = range.getBoundingClientRect();
      const overlaps = [
        ...document.querySelectorAll<HTMLElement>(".dashboard-actions button"),
      ]
        .filter((button) => {
          const b = button.getBoundingClientRect();
          return (
            b.left < text.right &&
            text.left < b.right &&
            b.top < text.bottom &&
            text.top < b.bottom
          );
        })
        .map((button) => button.textContent?.trim() ?? "");
      return {
        overlaps,
        inside: title.left >= 0 && text.right <= window.innerWidth,
      };
    });
    expect.soft(covered).toEqual({ overlaps: [], inside: true });
  });
});
