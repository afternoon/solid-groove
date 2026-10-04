import { expect, test } from "@playwright/test";

/**
 * #883: every lookahead node delays its signal by exactly the latency it
 * declares, in this browser's own Web Audio engine.
 *
 * Plugin delay compensation is declared, not measured: the Compressor and the
 * master limiter each state how many frames they hold the signal back, and
 * every other path is delayed to match. The unit suite pins the figure for its
 * own engine (`src/audio/devices/compressor.latency.test.ts`); this pins the
 * one production uses, in Chromium, Firefox and WebKit, so a browser that
 * holds a different figure fails here instead of misaligning a mix.
 */

const HARNESS = "/tests/e2e/mock/support/deviceLatencyHarness.ts";

test("lookahead nodes delay by exactly their declared latency", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const readings = await page.evaluate(async (harness) => {
    const module: typeof import("./support/deviceLatencyHarness") = await import(
      /* @vite-ignore */ harness
    );
    return module.readLatencies();
  }, HARNESS);
  expect(readings.length).toBeGreaterThan(0);
  for (const reading of readings) {
    expect(reading.measured, `${reading.path} at ${reading.sampleRate} Hz`).toBe(
      reading.declared,
    );
  }
});
