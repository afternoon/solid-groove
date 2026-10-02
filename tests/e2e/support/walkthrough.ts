import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Screenshot capture for a PR's screenshots, from any Playwright spec: a core
 * flow, an existing browser test, or a throwaway `*.screens.spec.ts` written
 * just to show a change (gitignored, so it never lands).
 *
 * Show what changed, not every step: a reviewer wants the one to five images
 * that make the change visible, not a dump of a whole journey.
 *
 * Capture is **off unless `CAPTURE_WALKTHROUGH=1`**, so the gating CI runs pay
 * nothing for it — `step()` is an await on a no-op. `bun run screenshots --
 * <spec>` and `bun run walkthrough:capture` set it; `bun run
 * walkthrough:publish` publishes the result. See `CLAUDE.md`, "Landing work".
 */

const CAPTURING = process.env.CAPTURE_WALKTHROUGH === "1";
const OUTPUT_ROOT = process.env.WALKTHROUGH_DIR ?? "walkthroughs";

export type WalkthroughFlow = {
  /** A short directory-safe label: a flow ID (`CF-001`) or a name like `mixer`. Keep it short; it is part of every image URL. */
  id: string;
  /** A heading for this group of images in the PR body. */
  title: string;
};

type StepRecord = { file: string; caption: string };

const slugify = (caption: string) =>
  caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "step";

/**
 * Opens a capture session for one group of images. Returns the `step` function the spec
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
 * Captions are prose, shown verbatim above the image in the PR body. Say what
 * the image shows ("The mixer strip with the new mute button").
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
