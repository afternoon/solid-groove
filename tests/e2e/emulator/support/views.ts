import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The editor's five views (#817), as every core flow that moves between them
 * names them: `1` Arrangement, `2` Sequence, `3` Instrument, `4` Library,
 * `5` Mixer.
 *
 * It lives here so the flows that #817 rewrote reach the same surface the same
 * way. **Every locator below that #817 introduces is assumed**; the
 * implementing PRs build to these names, or say in their body why one had to
 * change:
 *
 *  - the dock is still a navigation landmark named "Views" (CF-008, #304),
 *    holding five links whose accessible names are exactly the view names. A
 *    tile shows only its icon and key, so the view you are on is read off
 *    `aria-current="page"` by accessible name, never by text;
 *  - a tile's hover tip is a `tooltip` naming the view, its key and what it
 *    will open: "2 Sequence · Four on the floor", "4 Library · sounds for BD";
 *  - each view has its own address: `/projects/:id` for the arrangement, and
 *    `/sequence`, `/instrument`, `/library` and `/mixer` after it;
 *  - the sequence view is a region named "Sequence editor" — the name the
 *    modal carried, so the step and note locators inside it are unchanged —
 *    and it is a region, not a dialog;
 *  - the shared empty screen is a region named by its title ("No clip
 *    selected"), whose fix buttons are named for the view they go to and show
 *    that view's key.
 */

export const VIEWS = {
  Arrangement: { key: "1", path: "" },
  Sequence: { key: "2", path: "/sequence" },
  Instrument: { key: "3", path: "/instrument" },
  Library: { key: "4", path: "/library" },
  Mixer: { key: "5", path: "/mixer" },
} as const;

export type ViewName = keyof typeof VIEWS;

/** A view's address, as a pattern: `/projects/prj_…` plus its own segment. */
export const viewUrl = (view: ViewName): RegExp =>
  new RegExp(`/projects/prj_[^/]+${VIEWS[view].path}$`);

export const dock = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Views" });

export const dockTile = (page: Page, view: ViewName): Locator =>
  dock(page).getByRole("link", { name: view, exact: true });

export const currentTile = (page: Page): Locator =>
  dock(page).locator("[aria-current='page']");

/** The editor is on `view`: its address, and the dock's current-view marker. */
export async function expectView(page: Page, view: ViewName): Promise<void> {
  await expect(page).toHaveURL(viewUrl(view));
  await expect(currentTile(page)).toHaveCount(1);
  await expect(currentTile(page)).toHaveAccessibleName(view);
}

/** Go to a view by its key, and check you arrived. */
export async function pressView(page: Page, view: ViewName): Promise<void> {
  await page.keyboard.press(VIEWS[view].key);
  await expectView(page, view);
}

/** The sequence view (#817): the old modal's contents, as a page of its own. */
export const sequenceView = (page: Page): Locator =>
  page.getByRole("region", { name: "Sequence editor" });

/**
 * Leave the sequence view for the arrangement with `1` — what "close the
 * editor" became. The arrangement is back and the sequence view is gone.
 */
export async function backToArrangement(page: Page): Promise<void> {
  await pressView(page, "Arrangement");
  await expect(sequenceView(page)).toHaveCount(0);
  await page.getByTestId("arrangement-view-ready").waitFor();
}

/** The shared empty screen, named by its title. */
export const emptyScreen = (page: Page, title: string): Locator =>
  page.getByRole("region", { name: title });
