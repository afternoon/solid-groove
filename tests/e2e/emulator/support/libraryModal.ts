import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Today's library: the view a pad's sample slot opens (a region since the
 * library stopped being a modal), reached through the dock. The live library tests (`libraryRow`, `libraryKeys`) walk
 * this, while the parked core flows walk `./library`, which describes the
 * #817 views. When #817 lands, the live tests move onto `./library` and this
 * file goes.
 */

export const library = (page: Page): Locator =>
  page.getByRole("region", { name: "Library", exact: true });

export const soundList = (page: Page): Locator =>
  library(page).getByRole("list", { name: "Sounds", exact: true });

export const readout = (page: Page, name: "In the slot" | "Hearing"): Locator =>
  library(page).getByRole("group", { name });

export const railButton = (
  page: Page,
  name: "Browse packs" | "All sounds" | "Favourites",
): Locator => library(page).getByRole("button", { name: new RegExp(`^${name}\\b`) });

const drumMachine = (page: Page): Locator =>
  page.getByRole("region", { name: "Drum machine: BD" });

export const sampleSlot = (page: Page): Locator =>
  drumMachine(page).getByRole("button", { name: "Sample for BD", exact: true });

/** A new project, its "BD" pad's sample slot pressed, and the library open. */
export async function openBdSlot(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByTestId("arrangement-view-ready").waitFor();
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: "Instrument" })
    .click();
  await drumMachine(page)
    .getByRole("button", { name: "Audition BD", exact: true })
    .click();
  await sampleSlot(page).click();
  await expect(library(page)).toBeVisible();
}
