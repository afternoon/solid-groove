import { expect, type Locator, type Page, test } from "@playwright/test";
import { walkthrough } from "../../support/walkthrough";

/**
 * `CF-008` — a producer works across the arrangement, the instrument and the
 * mixer.
 *
 * Read the flow in `docs/core-flows.md`; the numbered comments below are its
 * steps, in its words. This is the acceptance contract for `UI-001` (#304) and
 * is frozen once it lands: a later PR that changes an assertion here has to say
 * so in its body and justify it.
 *
 * `test.fixme` because none of the shell exists — #304 is the stack that
 * removes this marker. What is missing today:
 *
 *  - **There are no views.** `EditorView` renders the library, the arrangement
 *    and a workspace of stacked panels all at once, in one scroll. There is no
 *    dock, nothing switches, and a project has exactly one address.
 *  - **Sequencing is not a modal.** The step editor and piano roll are panels
 *    below the arrangement, always mounted for whichever track is selected.
 *    Nothing opens from a clip.
 *  - **There is no instrument view.** `InstrumentArea` is a panel inside the
 *    workspace and there is no track rail to switch with.
 *
 * What this flow deliberately does *not* wait for is the device chain. The
 * instrument view reserves a place for it and #241 fills it; a flow that
 * asserted an empty slot would be asserting the absence of a feature, which
 * goes stale the moment it ships.
 *
 * Runs against the Firestore/Auth emulator, like every core flow: step 7 is a
 * real `page.reload()`, and the mock backend is a fresh, empty store on every
 * page load.
 *
 * ---
 *
 * **Why this flow moves by keyboard *and* by dock.** #304 gives the views two
 * entrypoints — the dock and `1`/`2`/`3` — and two entrypoints that reach
 * different states is the classic way a switcher rots. Steps 4 and 5 use the
 * keyboard, step 6 uses the dock, and every one of them asserts the dock's
 * current-view marker, so the two paths are held to the same state by
 * construction rather than by a separate test nobody runs.
 */

/** One bar of the alpha's fixed 4/4 at 192 PPQ (`src/domain/time.ts`). */
const TICKS_PER_BAR = 4 * 192;

/** The ruler strip's height in CSS pixels (`canvasRenderer.RULER_HEIGHT_PX`). */
const RULER_HEIGHT_PX = 22;

/** One track row's height (`ArrangementView.ROW_METRICS.trackHeightPx`). */
const ROW_HEIGHT_PX = 28;

/**
 * The view dock (#304): a landmark, and three links rather than tabs, because
 * a view is an address — `/projects/:id`, `/projects/:id/instrument`,
 * `/projects/:id/mixer` — and a link is what a person can open in a new tab,
 * copy, or reach with the back button. Which one you are on is `aria-current`,
 * the same way any navigation says so.
 */
const dock = (page: Page): Locator => page.getByRole("navigation", { name: "Views" });
const dockLink = (page: Page, name: string): Locator =>
  dock(page).getByRole("link", { name });
const currentView = (page: Page): Locator => dock(page).locator("[aria-current='page']");

/**
 * The interaction canvas the tracks are drawn on. A class, deliberately: it is
 * a `<canvas>`, so there is no role or accessible name to reach it by, and the
 * gesture that opens a clip is a coordinate on it (see CF-005 and CF-007).
 */
const timeline = (page: Page): Locator => page.locator(".arrangement-layer-interactive");

/**
 * The sequence editor #304 opens over the arrangement.
 *
 * `role="dialog"` is an accessibility fact — it is a window over the page, and
 * a screen reader has to be told so. It is deliberately *not* the shortcut
 * layer's `dialog` context: #304 gives it a `sequence_editor` context instead,
 * so the transport and the note shortcuts keep working while it is open. The
 * two words are unrelated, and step 3 below is what holds the distinction.
 */
const sequenceEditor = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Sequence editor" });

/** The instrument view's track rail, down the left edge. */
const trackRail = (page: Page): Locator => page.getByRole("list", { name: "Tracks" });

/** The arrangement's accessible mirror of the track list, top to bottom. */
const trackList = (page: Page): Locator =>
  page.getByRole("list", { name: "Arrangement tracks" }).getByRole("listitem");

test.describe("CF-008", () => {
  // `test.fixme` until #304 (UI-001) lands: the PR that closes it removes this
  // marker in the same diff that makes the flow pass.
  test.fixme(
    "a producer works across the arrangement, the instrument and the mixer",
    async ({ page }) => {
      const step = walkthrough(page, {
        id: "CF-008",
        title: "A producer works across the arrangement, the instrument and the mixer",
      });

      // 1. Create a new project. It opens on the arrangement, which fills the
      //    page, with the starter pattern on the only track and a dock along
      //    the bottom naming the three views.
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/projects\/prj_[^/]+$/);
      const arrangementUrl = page.url();
      await page.getByTestId("arrangement-view-ready").waitFor();
      await expect(trackList(page)).toHaveCount(1);

      await expect(dockLink(page, "Arrangement")).toBeVisible();
      await expect(dockLink(page, "Instrument")).toBeVisible();
      await expect(dockLink(page, "Mixer")).toBeVisible();
      await expect(currentView(page)).toHaveText("Arrangement");

      // The arrangement is the whole page now: the library column and the
      // stacked workspace beneath it are both gone, which is the change a
      // reviewer is actually looking at here.
      await expect(page.getByRole("region", { name: "Library" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Step editor" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Mixer" })).toHaveCount(0);
      await step("A new project opens on a full-page arrangement, with the dock");

      // 2. Open the clip on the timeline. The sequence editor comes up over the
      //    arrangement, nearly filling the window, showing the pattern.
      //
      // Where the starter clip is drawn can only be reached as a coordinate:
      // bar 1 of the first row, read through the horizontal scale the
      // arrangement publishes (`data-pixels-per-tick`, the hook CF-004
      // introduced).
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
      // The starter project's four-on-the-floor clip: steps 1, 5, 9, 13 on.
      // Two of them, plus an off step, so this cannot pass against an empty
      // grid — the same guard CF-001 carries.
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 1, on" }),
      ).toBeVisible();
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 5, on" }),
      ).toBeVisible();
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 2, off" }),
      ).toBeVisible();

      // "Nearly filling the window" is the point of the modal — the piano roll
      // in particular exists to get this room — so it is asserted rather than
      // left to the screenshot. Eight tenths of each axis is a floor, not a
      // target: it fails a panel that merely grew, and passes any of the
      // reasonable insets a designer might settle on.
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("This spec needs a sized viewport to measure.");
      const box = await sequenceEditor(page).boundingBox();
      if (!box) throw new Error("The sequence editor is visible but has no box.");
      expect(box.width).toBeGreaterThan(viewport.width * 0.8);
      expect(box.height).toBeGreaterThan(viewport.height * 0.8);
      await step("Open the clip — the sequence editor fills the window");

      // 3. Turn on a step that was off, then close the editor. The arrangement
      //    is underneath, exactly as it was apart from the edit.
      await sequenceEditor(page)
        .getByRole("button", { name: "Notes, step 2, off" })
        .click();
      await expect(
        sequenceEditor(page).getByRole("button", { name: "Notes, step 2, on" }),
      ).toBeVisible();
      await step("Turn on a step that was off");

      await page.keyboard.press("Escape");
      await expect(sequenceEditor(page)).toHaveCount(0);
      await expect(page).toHaveURL(arrangementUrl);
      await expect(trackList(page)).toHaveCount(1);
      await expect(currentView(page)).toHaveText("Arrangement");
      await step("Close it — the arrangement is underneath, unchanged");

      // 4. Go to the instrument view with the keyboard. The track's instrument
      //    fills the page, with a list of the project's tracks down the left
      //    edge and the dock still showing which view you are on.
      const trackName = ((await trackList(page).first().textContent()) ?? "").trim();
      expect(trackName).not.toBe("");

      await page.keyboard.press("2");
      await expect(page).toHaveURL(/\/projects\/prj_[^/]+\/instrument$/);
      await expect(currentView(page)).toHaveText("Instrument");
      await expect(
        page.getByRole("region", { name: `${trackName} instrument` }),
      ).toBeVisible();
      await expect(trackRail(page).getByRole("listitem")).toHaveCount(1);
      await expect(trackRail(page)).toContainText(trackName);
      // One job at a time: the timeline is not merely hidden behind the
      // instrument, it is not on the page.
      await expect(page.getByTestId("arrangement-view-ready")).toHaveCount(0);
      await step("Press 2 — the instrument fills the page, tracks down the left");

      // 5. Go to the mixer with the keyboard, and pull the track's volume fader
      //    down.
      await page.keyboard.press("3");
      await expect(page).toHaveURL(/\/projects\/prj_[^/]+\/mixer$/);
      const mixerUrl = page.url();
      await expect(currentView(page)).toHaveText("Mixer");
      await expect(page.getByRole("region", { name: "Mixer" })).toBeVisible();

      // The fader travels in its own normalized position, not in decibels
      // (`src/domain/faders.ts`); 0.4 is simply somewhere below where a new
      // track starts, which is all step 5 asks for.
      const fader = page.getByRole("slider", { name: `Volume for ${trackName}` });
      await expect(fader).toBeVisible();
      const restingVolume = Number(await fader.inputValue());
      await fader.fill("0.4");
      await expect(fader).toHaveValue("0.4");
      expect(restingVolume).toBeGreaterThan(0.4);
      await step("Press 3 — pull the track's fader down in the mixer");

      // 6. Go back to the arrangement from the dock. The timeline is as you
      //    left it, and the dock marks the arrangement as the view you are on.
      await dockLink(page, "Arrangement").click();
      await expect(page).toHaveURL(arrangementUrl);
      await expect(currentView(page)).toHaveText("Arrangement");
      await page.getByTestId("arrangement-view-ready").waitFor();
      await expect(trackList(page)).toHaveCount(1);
      await step("Back to the arrangement from the dock");

      // 7. Return to the mixer and reload the page. The project reopens on the
      //    mixer, with the fader still where you put it.
      //
      // The reload is only meaningful once the edits have been written, which
      // the save status is how the editor reports.
      await dockLink(page, "Mixer").click();
      await expect(page).toHaveURL(mixerUrl);
      await expect(page.locator(".save-status")).toHaveText("Saved", {
        timeout: 10_000,
      });
      await page.reload();

      // The view is part of the address, so the reload lands on the mixer
      // without anyone clicking anything — which is the half of this flow that
      // a session-scoped signal would quietly fail.
      await expect(page).toHaveURL(mixerUrl);
      await expect(currentView(page)).toHaveText("Mixer");
      await expect(
        page.getByRole("slider", { name: `Volume for ${trackName}` }),
      ).toHaveValue("0.4");
      await step("Reload the mixer — it reopens there, fader where you left it");
    },
  );
});
