import {
  assistantButton,
  composer,
  conversation,
  newProject,
  panel,
  panelButton,
  scope,
} from "./support/assistant";
import { expect, test } from "./support/test";

/**
 * The assistant's conversation (GRV-26) against the real gateway: the
 * `assistantTurn` callable in the Functions emulator, answering from its
 * scripted provider (`src/assistant/emulatorProvider.ts`). A marker in the
 * message picks the script: a plain message streams a short reply, `[hang]`
 * writes one piece and waits for Stop, `[flaky]` fails once and then works,
 * and `[propose]` ends in a proposal.
 */

const REPLY =
  "Here is one idea. Try a small change first, then listen to it in the loop.";

test.describe("the assistant's conversation", { tag: "@sanity" }, () => {
  test("sends, streams, stops and tries again through the gateway", async ({ page }) => {
    await newProject(page);
    await assistantButton(page).click();
    await expect(composer(page)).toBeFocused();
    await expect(scope(page)).toHaveAccessibleName("Scope: BD");

    // Send: Enter sends, the message is stamped with its scope, and the
    // reply streams in while Stop stands in for Send.
    await composer(page).fill("Make it groove");
    await page.keyboard.press("Enter");
    await expect(composer(page)).toHaveValue("");
    await expect(conversation(page)).toContainText("Make it groove");
    await expect(conversation(page)).toContainText(/Scope\W+BD\b/);
    await expect(panelButton(page, "Stop")).toBeVisible();
    await expect(conversation(page)).toContainText(REPLY);
    await expect(panelButton(page, "Send")).toBeVisible();
    await expect(conversation(page)).toHaveAttribute("aria-busy", "false");

    // Stop: the reply keeps what it wrote, and the composer has focus again.
    await composer(page).fill("Keep going [hang]");
    await page.keyboard.press("Enter");
    await expect(conversation(page)).toHaveAttribute("aria-busy", "true");
    await expect(panel(page)).toContainText("Writing…");
    await panelButton(page, "Stop").click();
    await expect(conversation(page)).toContainText("Here is one idea. Stopped.");
    await expect(composer(page)).toBeFocused();
    await expect(panel(page)).not.toContainText("Writing…");

    // Try again: a provider failure is an inline error that offers it, and
    // the retried turn's reply takes the error's place.
    await composer(page).fill(`Once more [flaky] ${test.info().testId}-${Date.now()}`);
    await page.keyboard.press("Enter");
    const failure = conversation(page).getByRole("alert");
    await expect(failure).toContainText("The assistant couldn't reply.");
    await expect(failure).toContainText("Your song is unchanged");
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(failure).toHaveCount(0);
    await expect(conversation(page).getByText(REPLY)).toHaveCount(2);
  });

  test("shows a proposal as a placeholder card", async ({ page }) => {
    await newProject(page);
    await assistantButton(page).click();
    await composer(page).fill("Speed it up [propose]");
    await page.keyboard.press("Enter");
    await expect(
      conversation(page).getByRole("region", { name: "Proposal" }),
    ).toContainText("A change is ready");
  });
});
