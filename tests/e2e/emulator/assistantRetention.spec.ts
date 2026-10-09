import { walkthrough } from "../support/walkthrough";
import {
  answerDisclosure,
  arrangement,
  assistantButton,
  composer,
  conversation,
  disclosure,
  newProject,
  panel,
  panelButton,
} from "./support/assistant";
import { expect, test } from "./support/test";

/**
 * The assistant's disclosure and its setting (GRV-8) against the real
 * `assistantRetention` callable in the Functions emulator: a fresh account
 * meets the disclosure before it can type, answers it, and finds the same
 * control, with its scope beside it, in the panel's settings.
 */

const LABEL = "Keep my conversations with the assistant for 30 days";
const SCOPE =
  "This controls Groove's own copy only. It does not take back anything already sent to Anthropic.";

test.describe("the assistant's disclosure and setting", () => {
  test("is answered before the first message, and changed later in settings", async ({
    page,
  }) => {
    const step = walkthrough(page, { id: "GRV-8", title: "Assistant disclosure" });
    await newProject(page);
    await assistantButton(page).click();

    // The disclosure stands where the composer would be.
    await expect(disclosure(page)).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
    await expect(disclosure(page)).toContainText("Anthropic does not use anything");
    await expect(disclosure(page)).toContainText(SCOPE);
    await step("Before the first message: what is sent, what is kept");

    await answerDisclosure(page, "Keep for 30 days");
    await expect(composer(page)).toBeFocused();
    await composer(page).fill("Make it groove");
    await page.keyboard.press("Enter");
    await expect(conversation(page)).toContainText("Here is one idea.");

    // The setting shows what was answered, and opening it changes nothing.
    await panelButton(page, "Assistant settings").click();
    const box = panel(page).getByRole("checkbox", { name: LABEL });
    await expect(box).toBeChecked();
    await expect(panel(page)).toContainText(SCOPE);
    await step("The setting, with its scope beside it");

    await box.click();
    await expect(panel(page)).toContainText(
      "Groove has stopped keeping your conversations and deleted the ones it kept.",
    );
    await expect(box).not.toBeChecked();
    await step("Turned off: kept conversations are deleted");

    // A reload asks again from the account's stored answer: no disclosure.
    await page.reload();
    await arrangement(page).waitFor();
    // The panel remembers whether it was open on this device.
    if (!(await panel(page).isVisible())) await assistantButton(page).click();
    await expect(composer(page)).toBeVisible();
    await expect(disclosure(page)).toHaveCount(0);
    await panelButton(page, "Assistant settings").click();
    await expect(panel(page).getByRole("checkbox", { name: LABEL })).not.toBeChecked();
  });
});
