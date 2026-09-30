import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { ExportMemoryResult } from "./support/exportMemoryHarness";

/**
 * EXP-002: the 40-track, ten-minute processed reference project exports as a
 * stereo WAV within a browser tab's memory (PRD section 10's reference: every
 * track processed, at least 64 active devices).
 *
 * It renders ten minutes of audio, so it is opt-in: `EXPORT_MEMORY=1 bun run
 * test:browser:chromium -- exportMemory` (about 20 minutes in a 4-core
 * container). Peak memory is the resident set of Chromium's processes,
 * sampled from outside the page every 200 ms, which only Linux exposes this
 * way. The result is recorded on #65.
 */

const HARNESS = "/tests/e2e/mock/support/exportMemoryHarness.ts";
/** A tab with room to spare on an 8 GB laptop. */
const RENDERER_BUDGET_MB = 1_536;
/** The song's length; a shorter one only for probing the harness itself. */
const MINUTES = Number(process.env.EXPORT_MEMORY_MINUTES ?? 10);

/** Resident memory in MB: the largest Chromium renderer (the tab doing the
 * export), and every Chromium process together (the browser process holds
 * Blob data, so a copy moved out of the tab still counts there). */
function chromiumRssMb(): { renderer: number; total: number } {
  const table = execFileSync("ps", ["-eo", "rss=,args="], { encoding: "utf8" });
  let renderer = 0;
  let total = 0;
  for (const line of table.split("\n")) {
    const [rss, executable = ""] = line.trim().split(/\s+/);
    // The executable itself, so the test runner's `--project=chromium` is not counted.
    if (!/chrom|headless_shell/.test(executable.split("/").at(-1) ?? "")) continue;
    const mb = Number.parseInt(rss, 10) / 1024;
    total += mb;
    if (line.includes("--type=renderer")) renderer = Math.max(renderer, mb);
  }
  return { renderer, total };
}

test.describe("stereo export memory", () => {
  test.skip(
    !process.env.EXPORT_MEMORY || process.platform !== "linux",
    "opt-in: EXPORT_MEMORY=1, on Linux",
  );

  test("the processed reference project exports within the tab's budget", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "renderer RSS is read from Chromium");
    test.setTimeout(3_600_000);
    page.on("console", (message) => {
      if (message.text().startsWith("EXP-002")) console.log(message.text());
    });
    await page.goto("/");
    const idle = chromiumRssMb();

    const peak = { ...idle };
    const sampler = setInterval(() => {
      const now = chromiumRssMb();
      peak.renderer = Math.max(peak.renderer, now.renderer);
      peak.total = Math.max(peak.total, now.total);
    }, 200);
    let result: ExportMemoryResult;
    try {
      result = await page.evaluate(
        async ({ harness, minutes }) => {
          const module: typeof import("./support/exportMemoryHarness") = await import(
            /* @vite-ignore */ harness
          );
          return module.runProcessedExport(minutes);
        },
        { harness: HARNESS, minutes: MINUTES },
      );
    } finally {
      clearInterval(sampler);
    }

    const report = {
      ...result,
      idleRendererMb: Math.round(idle.renderer),
      peakRendererMb: Math.round(peak.renderer),
      idleBrowserTotalMb: Math.round(idle.total),
      peakBrowserTotalMb: Math.round(peak.total),
    };
    console.log(`EXP-002 export memory: ${JSON.stringify(report)}`);
    test
      .info()
      .annotations.push({ type: "export-memory", description: JSON.stringify(report) });

    expect(result.tracks).toBe(40);
    expect(result.devices).toBeGreaterThanOrEqual(64);
    expect(result.frames / result.sampleRate).toBeGreaterThanOrEqual(MINUTES * 60);
    expect(peak.renderer).toBeLessThan(RENDERER_BUDGET_MB);
  });
});
