import { expect, type Page, test } from "./support/test";

/**
 * GRV-61: a device's faders keep their labels and values apart when the
 * window is narrow. Each fader takes its share of its bank, and at ~800px a
 * Delay's banks used to be squeezed below the width its labels need, so
 * neighbouring labels ("TIME/FEEDBACK") and values ("8 kHz30%") ran into each
 * other. Text overflow is layout, which jsdom does not do, so it is measured
 * here.
 */

interface Box {
  readonly x: number;
  readonly width: number;
  readonly y: number;
}

/** Every pair of same-row boxes in `boxes` that overlaps horizontally. */
function overlaps(boxes: readonly (Box & { readonly text: string })[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (Math.abs(a.y - b.y) > 4) continue;
      if (a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5) {
        found.push(`${a.text} / ${b.text}`);
      }
    }
  }
  return found;
}

/** The painted extent of each element's text, not its (possibly clipped) box. */
async function textBoxes(
  page: Page,
  selector: string,
): Promise<(Box & { readonly text: string })[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      if (element instanceof HTMLInputElement) {
        // An input clips its text, so the overflow a user sees is the box
        // itself overrunning its neighbour, plus text too wide for it.
        const style = getComputedStyle(element);
        const canvas = document.createElement("canvas").getContext("2d");
        let textWidth = 0;
        if (canvas) {
          canvas.font = style.font;
          textWidth = canvas.measureText(element.value).width;
        }
        const width = Math.max(rect.width, textWidth);
        return {
          text: element.value,
          x: rect.x + rect.width / 2 - width / 2,
          width,
          y: rect.y,
        };
      }
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return { text: element.textContent ?? "", x: text.x, width: text.width, y: rect.y };
    }),
  );
}

test.describe("device controls at a narrow window", () => {
  test("a Delay's fader labels and values stay apart at 800px", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page
      .getByRole("navigation", { name: "Views" })
      .getByRole("link", { name: "Mixer" })
      .click();
    const master = page.getByRole("region", { name: "Master effects" });
    await master.getByRole("button", { name: "Add delay device" }).click();
    const controls = master.locator(".device-controls");
    await expect(controls.getByRole("slider", { name: "Feedback" })).toBeVisible();

    const labels = await textBoxes(page, ".device-controls .fill-slider-label");
    const values = await textBoxes(page, ".device-controls .fill-slider-entry");
    expect(labels.length).toBeGreaterThan(3);
    expect(overlaps(labels), "labels that run into each other").toEqual([]);
    expect(overlaps(values), "values that run into each other").toEqual([]);
  });
});
