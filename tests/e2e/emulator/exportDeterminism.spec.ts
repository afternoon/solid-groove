import { expect, test } from "@playwright/test";

/**
 * #867: exporting an unchanged song gives the same WAV, byte for byte, every
 * time.
 *
 * This runs in a browser because the cause only exists there: Blink sums a
 * node's inputs in an order that changes between renders, which the unit
 * suite's Web Audio implementation never does. The song in the harness sums
 * three or more signals at every kind of junction a render has, so each one
 * that is not summed in a fixed order (`src/audio/summingBus.ts`) shows up as
 * a different file.
 */

const HARNESS = "/tests/e2e/emulator/support/exportDeterminismHarness.ts";
const EXPORTS = 4;

test("exporting an unchanged song gives the same file every time", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const hashes = await page.evaluate(
    async ({ harness, times }) => {
      const module: typeof import("./support/exportDeterminismHarness") = await import(
        /* @vite-ignore */ harness
      );
      return module.exportRepeatedly(times);
    },
    { harness: HARNESS, times: EXPORTS },
  );
  expect(hashes).toHaveLength(EXPORTS);
  expect(new Set(hashes).size, hashes.join("\n")).toBe(1);
});
