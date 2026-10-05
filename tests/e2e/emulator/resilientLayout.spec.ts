import { newProject } from "./support/assistant";
import { expect, type Page, test } from "./support/test";
import { dock, pressView, type ViewName } from "./support/views";

/**
 * The editor holds together at 200% zoom and in a small window (#76).
 *
 * Browser zoom shrinks the CSS viewport: 200% on a 1280x720 window is a
 * 640x360 one. Below its minimum (960x600, a 1920x1200 screen at 200%) the
 * editor stops shrinking and the document scrolls instead, so no control runs
 * into another and nothing is out of reach. With reduced motion asked for,
 * nothing animates.
 */

/** Pairs of header controls whose boxes overlap, neither inside the other. */
const headerCollisions = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        ".editor-header button, .editor-header input, .editor-header [role='group']",
      ),
    ].filter((el) => el.getBoundingClientRect().width > 0);
    const name = (el: HTMLElement) =>
      el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
    const found: string[] = [];
    controls.forEach((a, i) => {
      for (const b of controls.slice(i + 1)) {
        if (a.contains(b) || b.contains(a)) continue;
        const [p, q] = [a.getBoundingClientRect(), b.getBoundingClientRect()];
        const overlap =
          p.left < q.right - 1 &&
          q.left < p.right - 1 &&
          p.top < q.bottom - 1 &&
          q.top < p.bottom - 1;
        if (overlap) found.push(`${name(a)} / ${name(b)}`);
      }
    });
    return found;
  });

const VIEWS: readonly ViewName[] = ["Sequence", "Instrument", "Library", "Mixer"];

test.describe("resilient layout", () => {
  test("at 200% zoom the editor keeps its minimum and scrolls rather than overlapping", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await newProject(page);

    const editor = await page.locator("main.editor").boundingBox();
    expect(editor?.width).toBeGreaterThanOrEqual(960);
    expect(editor?.height).toBeGreaterThanOrEqual(600);
    expect(await headerCollisions(page)).toEqual([]);

    // Everything is reachable by scrolling the document: the last header
    // control scrolls into view, and so does the foot of the editor.
    const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts" });
    await shortcuts.scrollIntoViewIfNeeded();
    await expect(shortcuts).toBeInViewport();

    // Every view opens and keeps its header clear, and the dock stays on screen.
    for (const view of VIEWS) {
      await pressView(page, view);
      expect(await headerCollisions(page), view).toEqual([]);
      await expect(dock(page)).toBeInViewport();
    }
  });

  test("at its minimum the editor fits the window exactly, with nothing to scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await newProject(page);
    expect(await headerCollisions(page)).toEqual([]);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow).toEqual({ x: 0, y: 0 });
  });

  test("with reduced motion asked for, nothing transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await newProject(page);
    const longest = await page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll("*")].flatMap((el) => {
          const style = getComputedStyle(el);
          return [style.transitionDuration, style.animationDuration].flatMap((list) =>
            list.split(",").map((value) => Number.parseFloat(value) || 0),
          );
        }),
      ),
    );
    // Seconds: 0.01ms is the most anything may take.
    expect(longest).toBeLessThanOrEqual(0.00001);
  });
});
