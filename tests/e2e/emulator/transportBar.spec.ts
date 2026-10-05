import { expect, test } from "./support/test";

// `LOOP-003`: the transport bar, in every gating browser. Playback itself is
// still Chromium-only (see `docs/testing.md`, "Playback is asserted in Chromium
// only"), but none of the surface below needs the context to unlock — the tempo
// command, the toggles' pressed state, the fixed 4/4 display, and text-entry
// suppression inside the BPM input are all assertable in Firefox today, and
// they are the parts of this task whose claim is cross-browser. Moved here from
// the retired mock-backend suite's `smoke.spec.ts`.
test.describe("transport bar", () => {
  test("edits tempo through a command, toggles loop and metronome, and shows 4/4", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page.getByTestId("arrangement-view-ready")).toBeVisible();

    // The bar.beat playhead at the arrangement start, as an editable field.
    await expect(page.getByTitle("Playhead (bar.beat)")).toHaveText(
      "Playhead at bar 1.1",
    );
    await expect(page.getByRole("spinbutton", { name: "Bar" })).toHaveValue("1");
    await expect(page.getByRole("spinbutton", { name: "Beat" })).toHaveValue("1");

    // Typing a bar jumps the playhead there without starting playback.
    await page.getByRole("spinbutton", { name: "Bar" }).fill("3");
    await page.getByRole("spinbutton", { name: "Bar" }).press("Enter");
    await expect(page.getByTitle("Playhead (bar.beat)")).toHaveText(
      "Playhead at bar 3.1",
    );
    // The CF-004/CF-007 locator still finds exactly one readout.
    await expect(page.getByText(/^Playhead at bar \d+\.\d+$/)).toHaveCount(1);

    // Tempo round-trips through the shared command layer: the input reads back
    // from `song.tempo`, and undo names the command that wrote it.
    const tempo = page.getByRole("spinbutton", { name: "Tempo (BPM)" });
    await expect(tempo).toHaveValue("120");
    await tempo.fill("144");
    await tempo.blur();
    await expect(tempo).toHaveValue("144");
    await expect(
      page.getByRole("button", { name: "Undo Set Tempo to 144 BPM" }),
    ).toBeEnabled();

    // Above the AUD-02 supported range the surface clamps before dispatching.
    await tempo.fill("999");
    await tempo.blur();
    await expect(tempo).toHaveValue("240");

    // Undo restores the previous tempo, so the transport bar is on the same
    // history as every other edit.
    await page.getByRole("button", { name: /^Undo Set Tempo/ }).click();
    await expect(tempo).toHaveValue("144");

    // Loop and metronome are toggles with real pressed state, and neither
    // needs playback to be running. A new project loops by default (LOOP-017).
    const loop = page.getByRole("button", { name: "Disable loop" });
    await expect(loop).toHaveAttribute("aria-pressed", "true");
    await loop.click();
    await expect(page.getByRole("button", { name: "Enable loop" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const metronome = page.getByRole("button", { name: "Enable metronome" });
    await expect(metronome).toHaveAttribute("aria-pressed", "false");
    await metronome.click();
    await expect(page.getByRole("button", { name: "Disable metronome" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // `Space` is `transport.play_stop` and `O` is `transport.metronome`. Inside
  // the BPM input they are text and a spinbutton keystroke, not transport
  // commands — the focus-safe half of the AUD-01 criterion, and it is provable
  // in every gating browser because it never unlocks the context.
  test("Space and O inside the tempo input do not reach the transport", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page.getByTestId("arrangement-view-ready")).toBeVisible();

    const tempo = page.getByRole("spinbutton", { name: "Tempo (BPM)" });
    await tempo.focus();
    await expect(tempo).toBeFocused();

    await page.keyboard.press("Space");
    await page.keyboard.press("o");

    // Neither mapping fired: playback never started and the click stayed off.
    await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable metronome" })).toBeVisible();
  });
});
