import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Screenshot capture for a core flow's walkthrough (see `docs/core-flows.md`).
 *
 * The walkthrough a reviewer reads on the pull request is a *byproduct of the
 * test that proves the flow*, not a separate errand someone remembers to do.
 * That is the whole point: a flow spec starts from a real entrypoint and walks
 * to the outcome, which is exactly the sequence a reviewer wants to see, and it
 * cannot drift from the shipped behavior because the same run produces both.
 *
 * Capture is **off unless `CAPTURE_WALKTHROUGH=1`**, so the gating CI runs pay
 * nothing for it — `step()` is an await on a no-op. Capture the images with
 * `bun run walkthrough:capture` and publish them with `bun run
 * walkthrough:publish`; see `docs/testing.md`.
 */

const CAPTURING = process.env.CAPTURE_WALKTHROUGH === "1";
const OUTPUT_ROOT = process.env.WALKTHROUGH_DIR ?? "walkthroughs";

export type WalkthroughFlow = {
	/** The flow's stable ID, e.g. `CF-001`. Must exist in `docs/core-flows.md`. */
	id: string;
	/** The flow's title, as written in `docs/core-flows.md`. */
	title: string;
};

type StepRecord = { file: string; caption: string };

const slugify = (caption: string) =>
	caption
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "step";

/**
 * Opens a capture session for one flow. Returns the `step` function the spec
 * calls at each point worth showing a reviewer.
 *
 * ```ts
 * const step = walkthrough(page, { id: "CF-001", title: "..." });
 * await page.goto("/");
 * await step("Open the landing page");
 * ```
 *
 * Call `step` *after* the assertions for that point, never before: a screenshot
 * taken ahead of its `expect` can catch a half-rendered page, and a walkthrough
 * showing a state the test never asserted is worse than no walkthrough at all.
 *
 * Captions are prose, shown verbatim under the image in the PR body. Write them
 * as the instruction a person would follow, matching the flow's numbered steps
 * in `docs/core-flows.md`.
 */
export function walkthrough(page: Page, flow: WalkthroughFlow) {
	const steps: StepRecord[] = [];
	const flowDirectory = join(OUTPUT_ROOT, flow.id);

	return async function step(caption: string): Promise<void> {
		if (!CAPTURING) return;

		const file = `${String(steps.length + 1).padStart(2, "0")}-${slugify(caption)}.png`;
		const path = join(flowDirectory, file);
		mkdirSync(dirname(path), { recursive: true });
		// Viewport rather than full page: the reviewer is judging what a person
		// sees on arrival, and a full-page capture of a scrolling editor
		// silently changes the framing between steps.
		await page.screenshot({ path });

		steps.push({ file, caption });
		// Rewritten after every step rather than once at the end, so a spec that
		// fails midway still leaves a readable partial walkthrough — which is
		// often exactly what you want to look at when diagnosing the failure.
		writeFileSync(
			join(flowDirectory, "index.json"),
			`${JSON.stringify({ id: flow.id, title: flow.title, steps }, null, 2)}\n`,
		);
	};
}
