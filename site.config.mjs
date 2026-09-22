/**
 * Where the site lives, and what it calls itself.
 *
 * One file, because these values are needed from three places that cannot
 * share a module system otherwise: the prerendered document shell
 * (`src/Document.tsx`, TypeScript, built by Vite), the build scripts under
 * `scripts/` (plain Node ESM), and the client. Plain data with no `process.env`
 * read, so it is safe in all three — an environment-specific override belongs
 * in `vite.config.ts`'s `define`, not here.
 *
 * Moving the site to another domain is an edit to `SITE_ORIGIN` alone.
 */

/** Public origin, no trailing slash. Canonical and `og:url` are built from it. */
export const SITE_ORIGIN = "https://groove.ben2.com";

/** The product's name, as it appears in a tab title and a link preview. */
export const SITE_NAME = "Solid Groove";

/**
 * The landing page's `<title>`.
 *
 * Also set as the route's title once the client mounts (see `LandingPage`), so
 * a crawler that executes JavaScript and one that does not read the same thing.
 */
export const SITE_TITLE = "Solid Groove — a music studio in your browser";

/**
 * The `<meta name="description">` and the link-preview description.
 *
 * Kept to one sentence and under 160 characters, which is roughly where search
 * results and unfurls truncate. It carries no claim the alpha has not shipped
 * (PRD `PRJ-06`) — the AI producer is described as what the studio is built
 * around, which is what the page's own lede says.
 */
export const SITE_DESCRIPTION =
  "A music studio that runs in your browser, built around an AI producer that proposes real, editable changes you can hear and undo.";

/**
 * The tab title inside the app.
 *
 * `src/app.tsx` sets it once the client mounts, and `scripts/emit-app-shell.mjs`
 * puts the same string in the deep-link shell, so a project page's tab reads
 * the same before and after the app has loaded. The landing page overrides it
 * with `SITE_TITLE`, which is the one a crawler and a link preview see.
 */
export const APP_TITLE = "Groove";
