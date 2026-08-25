import { expect, test } from "@playwright/test";

/**
 * `LOOP-001` — the anonymous-start dashboard's access control and destructive
 * confirmation, exercised against a real (emulated) backend so Firestore
 * security rules are actually enforced (the mock backend in `e2e/` has no
 * server-side security boundary to prove).
 */
test.describe("dashboard access control", () => {
  test("a project created by one anonymous session is invisible and inaccessible to another", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const strangerContext = await browser.newContext();
    try {
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto("/dashboard");
      await expect(ownerPage.getByRole("heading", { name: "Projects" })).toBeVisible();
      await ownerPage.getByRole("button", { name: "New Project" }).click();
      await expect(ownerPage).toHaveURL(/\/projects\/prj_/);
      const projectUrl = ownerPage.url();

      // A second, independent anonymous identity: its own browser context
      // gets its own Auth persistence, so this is a genuinely different uid.
      const strangerPage = await strangerContext.newPage();
      await strangerPage.goto("/dashboard");
      await expect(strangerPage.getByRole("heading", { name: "Projects" })).toBeVisible();
      // The owner's project does not leak into the stranger's listing —
      // `listProjects` is scoped to the caller's own uid.
      await expect(strangerPage.getByText("No projects yet")).toBeVisible();

      // Navigating straight to the owner's project URL: Firestore's security
      // rules deny the read (`isMember` requires owner or collaborator), and
      // the repository maps that `permission-denied` onto the same
      // `not_found` result an unknown project ID would produce — so this
      // reads as "not found" rather than a crash or a leaked existence check.
      await strangerPage.goto(projectUrl);
      await expect(
        strangerPage.getByRole("heading", { name: "This groove is broken" }),
      ).toBeVisible();
    } finally {
      await ownerContext.close();
      await strangerContext.close();
    }
  });
});

test.describe("destructive confirmation", () => {
  test("deleting a project requires confirmation, and the deletion persists across reload", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);

    await page.goto("/dashboard");
    await expect(page.getByText("Untitled Project")).toBeVisible();

    // Cancelling the confirmation leaves the project in place.
    await page.getByRole("button", { name: /^delete$/i }).click();
    const dialog = page.getByRole("alertdialog", {
      name: /delete this project/i,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Untitled Project")).toBeVisible();

    // Confirming actually deletes it.
    await page.getByRole("button", { name: /^delete$/i }).click();
    await page
      .getByRole("alertdialog", { name: /delete this project/i })
      .getByRole("button", { name: /^delete$/i })
      .click();
    await expect(page.getByText("No projects yet")).toBeVisible();

    // The deletion is a real write against the emulator, not just local
    // state — a reload still shows it gone.
    await page.reload();
    await expect(page.getByText("No projects yet")).toBeVisible();
  });
});
