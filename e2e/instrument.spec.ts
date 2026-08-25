import { expect, test } from "@playwright/test";
import { walkthrough } from "./support/walkthrough";

// #224: a track's instrument used to be fixed for its whole life — the
// `instrument.change` command existed but nothing dispatched it. This walks the
// repair path a producer takes: decide the part wants a different sound source,
// and change it in place rather than deleting the track and starting over.
test("changes a track's instrument from its own panel", async ({ page }) => {
  const step = walkthrough(page, {
    id: "issue-224",
    title: "Change a track's instrument",
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByRole("region", { name: "Step editor" })).toBeVisible();

  // `exact` because the track's instrument controls now sit in a region named
  // "<track> instrument" (#225), which a substring match would also select.
  const picker = page.getByRole("region", { name: "Instrument", exact: true });
  // The workspace scrolls inside a viewport-height app, so each capture
  // scrolls that container and then returns the page itself to the top —
  // otherwise the shot is framed on empty page below the editor.
  const show = async (name: string | RegExp): Promise<void> => {
    await page.getByRole("region", { name }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  // The starter track is a sampler, and the panel now says so out loud.
  await expect(page.getByRole("region", { name: "Sampler" })).toBeVisible();
  await show(/^Instrument$/);
  await step("Open a project: the track's instrument is a sampler");

  // Sampler -> synth, in one transaction the command layer can name.
  await picker.getByText("Synth", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Synth voice" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sampler" })).toHaveCount(0);
  await show("Synth voice");
  await expect(
    page.getByRole("button", { name: /^Undo Change .* to synth/ }),
  ).toBeEnabled();
  await step("Pick Synth: the synth panel replaces the sampler's");

  // ...and on to the drum machine, which arrives with the same pads a track
  // created as a drum machine gets (BD/SD/HH/CP, from the shared kind table).
  await picker.getByText("Drum machine", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Audition BD" })).toBeVisible();
  await show(/^Drum machine/);
  await step("Pick Drum machine: it arrives with pads to load");

  // The route back off a drum machine — the direction that had no UI at all,
  // since the drum machine's own panel is mounted elsewhere.
  await picker.getByText("Sampler", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Sampler" })).toBeVisible();

  // Each switch is one history entry, so undo walks back a step at a time.
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByRole("button", { name: "Audition BD" })).toBeVisible();
  await show(/^Drum machine/);
  await step("Undo returns the drum machine, one switch at a time");
});

// #246 replaced the sampler's swap list with the loaded sample's name and a
// "Drag a sound here from the library" hint. That hint sets the Sample group's
// width from its own longest line, which pushed the three parameter groups past
// the panel's content box: the amp envelope wrapped onto a second row and the
// panel grew from 273px tall to 491px, with a wide empty gap beside the wrapped
// group. The groups belong on one row.
test("keeps the sampler's parameter groups on one row", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByRole("region", { name: "Sampler" })).toBeVisible();

  const groups = page.locator(".sampler-panel .instrument-panel-group");
  await expect(groups).toHaveCount(3);
  const tops = await groups.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  // One row: every group shares a top edge. A wrapped group sits a row lower.
  expect(new Set(tops).size).toBe(1);
});
