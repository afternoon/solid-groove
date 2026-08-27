import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-007` — a producer drives the whole mix through an overdrive.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for `LOOP-020` (#283)
 * and is frozen once it lands: a later PR that changes an assertion here has to
 * say so in its body and justify it.
 *
 * `test.fixme` because the surface is entirely missing — #283 is the PR that
 * removes this marker. What is *not* missing is the processing: `LOOP-009`
 * shipped all six device types with real DSP (`src/audio/devices/`) and
 * `device.add/remove/reorder/duplicate/setBypass/reset` are registered commands
 * (`src/commands/definitions/devices.ts`). This flow is blocked on UI only:
 *
 *  - **The main region is not switchable.** `EditorView` renders the
 *    arrangement and nothing else in that slot; there are no view tabs.
 *  - **There is no master panel.** `Mixer` has no master channel and nothing
 *    anywhere renders a device chain, so a producer cannot reach an insert
 *    chain at all today (#241 tracks the same gap for tracks).
 *  - **Step 1 depends on #281** (CF-005's loop drop), which is how a second
 *    part gets into the project without a track-creation detour.
 *
 * Runs against the Firestore/Auth emulator rather than the mock backend,
 * because step 8 is a real `page.reload()` and the mock repository is a fresh,
 * empty store on every page load.
 *
 * ---
 *
 * **Why the undo comes before the drive is pushed.** A parameter gesture is a
 * command and therefore its own history entry (PRD 9.6; #283's criterion that a
 * control gesture "commits as one history entry per gesture"). Undoing after it
 * would put the drive back rather than take the device off, and redoing an
 * `device.add` restores the device as its payload described it, not as a later
 * edit left it. The flow undoes and redoes the add first, then pushes the drive,
 * so each of its claims is literally true. The register was corrected to match
 * before this spec was written; see CF-007's "Out of scope".
 */

/** The main region's master view, and the tab that reaches it (#283). */
const masterTab = (page: Page): Locator => page.getByRole("tab", { name: "Master" });
const masterView = (page: Page): Locator =>
  page.getByRole("tabpanel", { name: "Master" });

/**
 * The master's device chain, in order.
 *
 * A named list is what "lists the master chain in order" has to be for a
 * keyboard and a screen reader, and it is what this spec counts devices in.
 */
const masterChain = (page: Page): Locator =>
  masterView(page).getByRole("list", { name: "Master chain" });

/** The interaction canvas the tracks are drawn on — see CF-005 on why a class. */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/** The ruler strip's height in CSS pixels (`canvasRenderer.RULER_HEIGHT_PX`). */
const RULER_HEIGHT_PX = 22;

/** One track row's height (`ArrangementView.ROW_METRICS.trackHeightPx`). */
const ROW_HEIGHT_PX = 28;

/** The transport's playhead readout, by the accessible text `EditorHeader` gives it. */
const playheadReadout = (page: Page): Locator =>
  page.getByText(/^Playhead at bar \d+\.\d+$/);

test.describe("CF-007", () => {
  // `test.fixme` until #283 (LOOP-020) lands: that PR removes this marker in
  // the same diff that makes the flow pass.
  test.fixme(
    "a producer drives the whole mix through an overdrive",
    async ({ page, browserName }) => {
      // Playback runs across several steps of this flow in real time.
      test.setTimeout(120_000);

      const step = walkthrough(page, {
        id: "CF-007",
        title: "A producer drives the whole mix through an overdrive",
      });

      /*
       * Playback is asserted in Chromium only — the known, tracked gap CF-001
       * and `tests/e2e/emulator/slice.spec.ts` already carry (Firefox
       * constructs an `AudioContext` here whose `resume()` never settles). See
       * docs/testing.md, "Playback is asserted in Chromium only", and #43.
       *
       * The chain, the controls, the history and the reload — everything this
       * flow's own "Out of scope" says it proves — run in both gating browsers.
       */
      const canAssertPlayback = browserName === "chromium";
      test.info().annotations.push({
        type: canAssertPlayback ? "playback-asserted" : "playback-skipped",
        description: canAssertPlayback
          ? `playback asserted in ${browserName}`
          : `playback not asserted in ${browserName}: AudioContext.resume() is refused here — see HARD-001`,
      });

      // 1. Create a new project and drop a library loop onto the track area, so
      //    the starter kick and a loop are playing together.
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_/);
      const projectUrl = page.url();
      await expect(page.getByRole("button", { name: "Notes, step 1, on" })).toBeVisible();
      await page.getByTestId("arrangement-view-ready").waitFor();

      const libraryPanel = page.getByRole("region", { name: "Library" });
      await libraryPanel.getByRole("searchbox", { name: "Search sounds" }).fill("loop");
      await libraryPanel.getByRole("button", { expanded: false }).first().click();
      // A loop states the tempo it was recorded at; a one-shot has none, and a
      // one-shot dropped here would load a sampler instead of making a track.
      const loopRow = libraryPanel
        .getByRole("button", { name: /^Audition / })
        .locator("..")
        .filter({ hasText: /BPM/ })
        .first();
      const box = await timeline(page).boundingBox();
      if (!box) throw new Error("The arrangement timeline has no box to drop on.");
      await loopRow.dragTo(timeline(page), {
        targetPosition: {
          x: Math.min(box.width - 8, box.width / 2),
          y: RULER_HEIGHT_PX + ROW_HEIGHT_PX * 3,
        },
      });
      await expect(
        page.getByRole("list", { name: "Arrangement tracks" }).getByRole("listitem"),
      ).toHaveCount(2);
      await step("A project with the starter kick and a library loop");

      // 2. Start playback. The two parts repeat over the loop brace.
      await page.getByRole("button", { name: "Start playback" }).click();
      if (canAssertPlayback) {
        await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
        await expect(page.getByTestId("arrangement-loop-live")).toContainText(
          "bars 1 to",
        );
        await step("Both parts play over the loop brace");
      }

      // 3. Switch the main region from the arrangement to the master.
      await masterTab(page).click();
      await expect(masterTab(page)).toHaveAttribute("aria-selected", "true");

      // 4. The master's effects are on screen, with an empty chain. Add an
      //    overdrive to it.
      await expect(masterView(page)).toBeVisible();
      await expect(masterChain(page).getByRole("listitem")).toHaveCount(0);
      await step("The master is on screen, with an empty chain");

      await masterView(page)
        .getByRole("button", { name: /^Add device/i })
        .click();
      // #283 offers the six registered device types from their registry
      // definitions; the flow does not dictate whether that offer is a menu, a
      // listbox or a row of buttons, so any of the three satisfies it.
      await page
        .getByRole("menuitem", { name: "Overdrive" })
        .or(page.getByRole("option", { name: "Overdrive" }))
        .or(page.getByRole("button", { name: "Overdrive" }))
        .first()
        .click();
      await expect(masterChain(page).getByRole("listitem")).toHaveCount(1);
      await expect(masterChain(page)).toContainText("Overdrive");
      await step("Add an overdrive to the master chain");

      // 5. Undo once. The overdrive comes off the master chain.
      //
      // Nothing has been edited since the add, so the one entry on the stack is
      // the add itself.
      await page.getByRole("button", { name: /^Undo/ }).click();
      await expect(masterChain(page).getByRole("listitem")).toHaveCount(0);
      await step("Undo once — the overdrive comes off");

      // 6. Redo. It is back.
      await page.getByRole("button", { name: /^Redo/ }).click();
      await expect(masterChain(page).getByRole("listitem")).toHaveCount(1);
      await expect(masterChain(page)).toContainText("Overdrive");
      await step("Redo — it is back");

      // 7. While it is still playing, drive the overdrive up. The control
      //    follows and playback never drops out.
      //
      // "Drive" is the overdrive's own parameter definition
      // (`src/domain/devices.ts`), normalized 0-1 and defaulting to 0.3, and
      // the panel's control is generated from that definition rather than from
      // literals — so this sets a value in the parameter's own range.
      const drive = masterView(page).getByRole("slider", { name: "Drive" });
      await expect(drive).toBeVisible();
      await drive.fill("0.8");
      await expect(drive).toHaveValue("0.8");

      if (canAssertPlayback) {
        // "Playback never drops out", observed through the transport rather
        // than a level reading: a meter in a headless browser with no output
        // device is not evidence of anything, and this flow's own "Out of
        // scope" says it proves the chain, the controls and the state — not the
        // processing, which the audio suite asserts. A playhead still advancing
        // after the edit is the claim that matters: the graph did not stall or
        // rebuild.
        await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
        const before = (await playheadReadout(page).textContent()) ?? "";
        await expect
          .poll(async () => (await playheadReadout(page).textContent()) ?? "", {
            timeout: 10_000,
          })
          .not.toBe(before);
      }
      await step("Drive it up while it plays");

      if (canAssertPlayback) {
        await page.getByRole("button", { name: "Stop playback" }).click();
        await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
      }

      // 8. Reload the page. The overdrive is still on the master chain, still
      //    at that drive.
      //
      // The reload is only meaningful once the edits have been written, which
      // the save status is how the editor reports.
      await expect(page.locator(".save-status")).toHaveText("Saved", {
        timeout: 10_000,
      });
      await page.reload();
      await expect(page).toHaveURL(projectUrl);
      await masterTab(page).click();
      await expect(masterChain(page).getByRole("listitem")).toHaveCount(1);
      await expect(masterChain(page)).toContainText("Overdrive");
      await expect(masterView(page).getByRole("slider", { name: "Drive" })).toHaveValue(
        "0.8",
      );
      await step("Reload — the overdrive is still there, still at that drive");
    },
  );
});
