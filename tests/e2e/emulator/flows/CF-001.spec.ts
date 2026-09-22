import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-001` — a visitor with no account reaches a playing loop.
 *
 * This is the worked example for the core-flow convention: read
 * `docs/core-flows.md` for the flow this reproduces, and copy this file's shape
 * when writing a new one. Three properties are what make it a *flow* spec
 * rather than an ordinary E2E test:
 *
 *  - It starts at an entrypoint a person could actually arrive at — the public
 *    landing page — and never deep-links into seeded state. That is what makes
 *    the captured walkthrough worth a reviewer's time.
 *  - Its steps are the register's numbered steps, one `step()` caption each, in
 *    the same order and the same words. When they diverge, the register is
 *    right and this file is wrong.
 *  - It asserts the outcome the register promises, and stops. Neighbouring
 *    behavior is covered at the lowest useful layer, not bolted on here — a
 *    flow spec that grows assertions becomes a flow nobody can read.
 *
 * **Rewritten for the three-view shell (#304), and parked at `test.fixme`
 * until that stack lands.** This flow shipped live and passing; what changed
 * under it is where the pattern is edited. A project used to open with the step
 * editor mounted below the arrangement, so steps 5 and 6 could assert the grid
 * on arrival. #304 makes the arrangement the whole page and moves sequencing
 * into an editor opened from the clip, so the old assertions describe a surface
 * that is being deleted and the new ones describe one that does not exist yet.
 *
 * `test.fixme` is the only honest state in between: the rewrite cannot be true
 * before the shell exists, and leaving the old wording in place would have made
 * the register contradict CF-008 — which asserts, at the same moment in the same
 * journey, that no step editor is on the page. The PR that closes #304 removes
 * this marker in the same diff that makes the flow pass, exactly as it does for
 * CF-008. Until then the register has no live flow, which is a real cost and a
 * deliberate one: a wrong live flow is worse than a parked correct one.
 *
 * Runs against the Firestore/Auth emulator, like every core flow (`TEST-001`):
 * a flow's outcome includes surviving a reload, and the in-memory mock backend
 * this spec used to live over is a fresh, empty store on every page load. The
 * journey itself is unchanged — CF-001's register entry still claims nothing
 * about persistence, and this spec still asserts nothing about it.
 */

/** One bar of the alpha's fixed 4/4 at 192 PPQ (`src/domain/time.ts`). */
const TICKS_PER_BAR = 4 * 192;

/** The ruler strip's height in CSS pixels (`canvasRenderer.RULER_HEIGHT_PX`). */
const RULER_HEIGHT_PX = 22;

/** One track row's height (`ArrangementView.ROW_METRICS.trackHeightPx`). */
const ROW_HEIGHT_PX = 28;

/** The interaction canvas the tracks are drawn on — see CF-008 on why a class. */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/** The sequence editor #304 opens over the arrangement (see CF-008). */
const sequenceEditor = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Sequence editor" });

test.describe("CF-001", () => {
  // `test.fixme` until #304 (UI-001) lands: the PR that closes it removes this
  // marker in the same diff that makes the flow pass again.
  test.fixme(
    "a visitor with no account reaches a playing loop",
    async ({ page, browserName }) => {
      const step = walkthrough(page, {
        id: "CF-001",
        title: "A visitor with no account reaches a playing loop",
      });

      // 1. Open the landing page.
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
      ).toBeVisible();
      await step("Open the landing page");

      // 2. Choose to start in your browser.
      await page.getByRole("link", { name: "Start in your browser" }).click();

      // 3. You arrive at the dashboard, signed in as a guest, with no projects.
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await expect(page.getByText(/You're working as a guest/)).toBeVisible();
      await expect(page.getByText("No projects yet")).toBeVisible();
      await step("You arrive at the dashboard as a guest, with no projects yet");

      // 4. Create a new project.
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_/);

      // 5. It opens on the arrangement, with a starter pattern on its only
      //    track.
      await page.getByTestId("arrangement-view-ready").waitFor();
      await expect(
        page.getByRole("list", { name: "Arrangement tracks" }).getByRole("listitem"),
      ).toHaveCount(1);
      await step("The new project opens on the arrangement, with a starter pattern");

      // 6. Open that clip. The sequence editor comes up over the arrangement,
      //    showing the pattern.
      //
      // Where the clip is drawn can only be reached as a coordinate: bar 1 of
      // the first row, through the horizontal scale the arrangement publishes
      // (`data-pixels-per-tick`, the hook CF-004 introduced).
      const pixelsPerTick = Number(
        await page
          .getByTestId("arrangement-view-ready")
          .getAttribute("data-pixels-per-tick"),
      );
      expect(pixelsPerTick).toBeGreaterThan(0);
      await timeline(page).dblclick({
        position: {
          x: (TICKS_PER_BAR / 2) * pixelsPerTick,
          y: RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2,
        },
      });

      await expect(sequenceEditor(page)).toBeVisible();
      // The starter project's four-on-the-floor clip: steps 1, 5, 9, 13 on. Two
      // of them, plus an off step, so this cannot pass against an empty grid.
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 1, on" }),
      ).toBeVisible();
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 5, on" }),
      ).toBeVisible();
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 2, off" }),
      ).toBeVisible();
      await step("Open the clip — the sequence editor shows the starter pattern");

      // 7. Turn on a step that was off, and close the editor.
      await sequenceEditor(page)
        .getByRole("button", { name: "Notes, step 2, off" })
        .click();
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 2, on" }),
      ).toBeVisible();
      await step("Turn on a step that was off");

      await page.keyboard.press("Escape");
      await expect(sequenceEditor(page)).toHaveCount(0);

      // 8. Start playback.
      //
      // The transport is what this asserts — that the button flips to its
      // playing state, which only happens once `useProjectAudio.play()` has
      // resumed the shared AudioRuntime and started the transport. It is NOT an
      // assertion that a sound reached a speaker: a headless browser records no
      // audio and Playwright captures none. See docs/core-flows.md's "Out of
      // scope" for this flow, docs/testing.md, and issue #43.
      //
      // Asserted in Chromium only — the known, tracked gap this flow's own "Out
      // of scope" already names, and the same guard `tests/e2e/mock/smoke.spec.ts` and
      // `tests/e2e/emulator/slice.spec.ts` carry. In Firefox here `AudioContext`
      // constructs but its `resume()` never settles, so `play()` times out into
      // `audio_start_failed` and the button never becomes "Stop playback".
      // `LOOP-003` bounded that hang; it did not make Firefox play. The cause is
      // `HARD-001`'s real-hardware cross-browser pass — do not unguard this
      // before then. See docs/testing.md, "Playback is asserted in Chromium
      // only", and issue #43.
      const canAssertPlayback = browserName === "chromium";
      test.info().annotations.push({
        type: canAssertPlayback ? "playback-asserted" : "playback-skipped",
        description: canAssertPlayback
          ? `playback asserted in ${browserName}`
          : `playback not asserted in ${browserName}: AudioContext.resume() is refused here — see HARD-001`,
      });

      // The click itself runs in every gating browser: the gesture, the command
      // path behind it and the button staying mounted are real coverage, and a
      // crash on click would still fail here. Only the transport's *playing*
      // state is Chromium-only.
      await page.getByRole("button", { name: "Start playback" }).click();
      if (canAssertPlayback) {
        await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
        // The walkthrough is captured from the Chromium run
        // (`walkthrough:capture` passes `--project=chromium`), so this caption
        // is only ever recorded from a run that actually asserted it.
        await step("Start playback — the transport is running");
      }
    },
  );
});
