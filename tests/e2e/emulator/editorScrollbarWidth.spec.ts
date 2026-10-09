import { newProject } from "./support/assistant";
import { expect, test } from "./support/test";
import { pressView } from "./support/views";

// GRV-57: the editor fits the page area beside a classic vertical scrollbar,
// not the whole window. It was `width: 100vw`, which ignores the scrollbar and
// left Sign out under it plus a horizontal scrollbar. Playwright hides
// scrollbars in headless Chromium, so bring the classic 15px one back.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test.describe("editor width beside a classic scrollbar", () => {
  for (const view of ["Mixer", "Instrument"] as const) {
    test(`${view} fits the page area`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await newProject(page);
      await pressView(page, view);

      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const right = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect().right ?? Number.NaN;
        const account = [
          ...document.querySelectorAll<HTMLElement>(".editor-header button"),
        ]
          .filter((b) => /^(Sign out|Log in)$/.test(b.textContent?.trim() ?? ""))
          .map((b) => b.getBoundingClientRect().right);
        return {
          clientWidth: de.clientWidth,
          scrollWidth: de.scrollWidth,
          verticalScroll: de.scrollHeight > de.clientHeight,
          header: right(".editor-header"),
          editor: right(".editor"),
          account: account[0] ?? Number.NaN,
        };
      });

      // The setup is a real classic scrollbar: 1280 less its 15px.
      expect(m.verticalScroll).toBe(true);
      expect(m.clientWidth).toBe(1265);
      expect(m.header).toBeLessThanOrEqual(m.clientWidth);
      expect(m.editor).toBeLessThanOrEqual(m.clientWidth);
      expect(m.account).toBeLessThanOrEqual(m.clientWidth);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    });
  }
});
