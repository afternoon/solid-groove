import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type {
	ArrangementSpikeHandle,
	TraceName,
	TraceResult,
} from "../src/arrangement/spike/ArrangementSpike";
import {
	ARRANGEMENT_SPIKE_TRACK_COUNTS,
	type ArrangementSpikeTrackCount,
} from "../src/domain/fixtures";

/**
 * The FND-008 measurement harness (backlog task; PRD section 9.3, "When
 * these budgets are enforced"). Runs the four scripted traces the task
 * requires — scroll, zoom, seek, selection — against all three benchmark
 * track counts, and writes the collected frame-time/long-task/redraw/memory
 * numbers to `docs/perf/arrangement-spike-baseline.json` alongside the
 * hardware and browser that produced them.
 *
 * Single documented command: `bun run bench:arrangement` (see
 * `docs/arrangement-renderer-spike.md`). This is not gated on hitting any
 * PRD budget and does not fail the suite on a slow number — it fails only if
 * the harness itself is broken (the spike doesn't load, an API is missing).
 */

const TRACE_NAMES: readonly TraceName[] = [
	"scroll",
	"zoom",
	"seek",
	"selection",
];
const OUTPUT_PATH = fileURLToPath(
	new URL("../docs/perf/arrangement-spike-baseline.json", import.meta.url),
);

interface BaselineResult {
	readonly trackCount: ArrangementSpikeTrackCount;
	readonly trace: TraceName;
	readonly frameCount: number;
	readonly medianFrameMs: number;
	readonly p95FrameMs: number;
	readonly medianDrawMs: number;
	readonly p95DrawMs: number;
	readonly longTaskCount: number;
	readonly longTaskTotalMs: number;
	readonly redrawCounts: TraceResult["redrawCounts"];
	readonly heapUsedMB: number | null;
}

const results: BaselineResult[] = [];
let browserVersion: string | undefined;

for (const trackCount of ARRANGEMENT_SPIKE_TRACK_COUNTS) {
	test.describe(`${trackCount}-track arrangement`, () => {
		for (const trace of TRACE_NAMES) {
			test(`${trace} trace`, async ({ page }) => {
				browserVersion ??= page.context().browser()?.version();

				await page.goto(`/spike/arrangement?tracks=${trackCount}`);
				await expect(
					page.locator('[data-testid="arrangement-spike-ready"]'),
				).toBeAttached();
				// Let the initial layered draw (background/content/interaction)
				// settle before measuring, so first-paint cost isn't attributed to
				// the scripted trace.
				await page.waitForTimeout(250);

				const result = await page.evaluate(async (traceName: TraceName) => {
					const handle = (
						window as unknown as {
							__arrangementSpike?: ArrangementSpikeHandle;
						}
					).__arrangementSpike;
					if (!handle) {
						throw new Error("window.__arrangementSpike was not installed");
					}
					return handle.runScriptedTrace(traceName, 120);
				}, trace);

				results.push({ trackCount, ...result });
			});
		}
	});
}

test.afterAll(async ({ browserName }) => {
	if (results.length === 0) return;

	const report = {
		generatedAt: new Date().toISOString(),
		task: "FND-008",
		note:
			"Phase 0 renderer-spike baseline. Not gated on the PRD 9.3 " +
			"performance budgets, which bind at ARR-005/HARD-001 on the physical " +
			"baseline device — see docs/arrangement-renderer-spike.md. These " +
			"numbers are whatever this run's hardware measured, recorded " +
			"honestly rather than compared against a target.",
		hardware: {
			platform: os.platform(),
			arch: os.arch(),
			cpuModel: os.cpus()[0]?.model ?? "unknown",
			cpuCount: os.cpus().length,
			totalMemoryGiB: Number((os.totalmem() / 2 ** 30).toFixed(1)),
		},
		browser: {
			name: browserName,
			version: browserVersion ?? "unknown",
		},
		results,
	};

	await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
	await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
});
