# ADR 0008 - Statically generating the landing page in the document shell

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-09-22 |
| Decides | How the public landing page reaches a visitor, a crawler, and a link preview before any application JavaScript has run |
| Relates to | [ADR 0005](./0005-leaving-solidstart-for-the-vite-plugin.md), which adopted client start mode and explicitly deferred this question ("It does not reopen client-only rendering") |
| Affects | `src/Document.tsx` (new), `src/router.tsx`, `src/app.tsx`, `src/components/LandingPage*.tsx`, `firebase.json`, `public/robots.txt`, `scripts/emit-app-shell.mjs`, `scripts/verify-landing-static.mjs`, `site.config.mjs` |

## Context

`vite build` emitted a `dist/client/index.html` whose body was literally `<body></body>`, with no `<title>` and no metadata of any kind. Everything a visitor sees at `/` — the product's only public page — existed solely as the result of the client entry chunk downloading, parsing, executing, and `render()`ing a lazily-imported route module.

Three costs followed from that, and all three land on the surface the PRD gives the strictest first-impression budget (`PRJ-06`):

1. **Nothing was indexable.** A crawler that does not execute JavaScript saw an empty document. There was no title, no description, and no copy — not a thin page, an empty one.
2. **Nothing unfurled.** There were no `og:` or `twitter:` tags at all, so the product's link in a message or a post rendered as a bare URL.
3. **First paint waited on the whole chain.** Entry chunk, then the lazy route chunk, then that chunk's stylesheet, before a single pixel of content.

ADR 0005 anticipated this being asked later. It adopted `@solidjs/vite-plugin`'s client start mode and recorded that flipping the project to SSR "is a single boolean upstream (`ssr: true`), and it would be its own decision with its own consequences". This is that decision — and it declines the boolean.

## Decision

**Render the landing page into the document shell at build time. Do not enable SSR, hydration, or a server bundle.**

1. **`src/Document.tsx` is the mechanism**, which is the plugin's own documented hook (`start.document`). Client start mode already prerenders the shell once through the built handler into `index.html`; the shell simply stops being empty. **The application still never renders on the server** — the plugin's generated entry renders `<Document />` alone, the client `render()`s (never hydrates), and `dist/client` remains the entire deployable with no server bundle. The PRD's client-only decision is untouched.

2. **The markup is shared, not duplicated.** `LandingPageContent` holds the page's copy and markup with no imports beyond Solid; `LandingPage` holds its behaviour (analytics, the dynamic auth import, navigation, state). Both the shell and the live app render the same component, so the prerendered HTML cannot drift from what the app shows. The shell omits only the footer's telemetry disclosure, which reads the consent store, and the client supplies it on mount.

3. **The landing route is eager; every other route stays lazy.** Prerendered markup is only worth having if it is styled at first paint and replaced without a flash. As a lazy route, the page's stylesheet lived in a chunk the shell did not link, so the static copy painted unstyled and then flashed through the loading fallback before the live page arrived. Eager, its CSS is in the entry graph's stylesheet — already in the shell's `<head>` — and `App` drops the static node synchronously as the live tree is inserted. The cost is a few kilobytes of markup in the entry chunk on every route; the SDK separation that mattered is unaffected, because it comes from the dashboard's own chunk and from the landing page reaching `authService` through a dynamic `import()`.

4. **Two documents, one shell.** The generated server entry renders `<Document />` with **no request**, so the shell cannot be path-aware. Rather than fight that, the split happens after the build: every landing-only node carries `data-landing="true"`, `scripts/emit-app-shell.mjs` removes exactly those and writes `app.html`, and `firebase.json` serves `/` from `index.html` and `**` from `app.html`. The dev server and `vite preview` serve one shell by history fallback, so an inline parser-blocking script removes the markup during parse when the path is not `/` — the three environments reach the same state before first paint.

5. **`site.config.mjs` owns the origin.** Canonical URL, `og:url`, titles, and description live in one plain-data module that TypeScript, the client, and the plain-Node build scripts can all import. Moving the site to another domain is an edit to `SITE_ORIGIN` alone.

6. **`robots.txt` allows `/` and disallows the app's routes.** `/dashboard` is one person's project list and `/projects/*` is one project's editor; both are client-rendered shells behind a session with nothing to index.

7. **No `og:image`.** The alpha has no artwork that is true to what it ships, and the design mock shows capabilities it has not built, which `PRJ-06` forbids advertising. A text-only `summary` card is honest; a large-image card with nothing to show is not. Adding one is a later, deliberate change.

## What this does not decide

- **It does not enable SSR.** `ssr: true` would turn on hydratable transforms app-wide, require every route's module graph to be server-safe, and ship a server bundle to run. None of that is needed to put one static page in front of visitors, and all of it would have to be operated.
- **It does not prerender any other route.** `/dashboard` and `/projects/:id` are session-scoped and have nothing to statically generate.
- **It does not add a sitemap.** One indexable page does not need one.
- **It does not change the PRD.** Section 9.1's framework row and the client-only decision both stand as written.

## Consequences

### What this buys

- `/` is indexable, unfurls with a title and description, and paints its content — styled — with JavaScript disabled entirely.
- The landing page costs one round trip instead of three (shell, entry chunk, route chunk + its CSS), and its content is in the first response.
- The mechanism is the plugin's own supported hook, so it survives an upgrade better than a bolted-on prerender step would, and ADR 0005's migration story is intact: `ssr: true` remains one boolean away, with the same `Document`.

### What this costs

- **A build-output contract that source review cannot see.** "The shell renders the page" and "the deep-link shell does not" are properties of `dist/`, not of any file. `scripts/verify-landing-static.mjs` exists because of that, runs in CI and before every deploy, and fails in both directions; it was checked against a doctored build to confirm it does.
- **A second HTML artifact, and a hosting rule that must match it.** `app.html` is generated, and `firebase.json`'s rewrites decide which document each path gets. Someone adding a rewrite has to know that `/` is special. The verifier asserts the rewrite table as well, so the two cannot drift apart silently.
- **One inline script in the document.** It is the only one, it reads nothing but `location.pathname`, and it exists because the shell has no request to branch on. It would need revisiting under a strict CSP.
- **`data-landing="true"` is now load-bearing.** A landing-only tag added to the document without it ships on every deep link. That is precisely what the verifier's second half checks.
- **The landing page is in the entry chunk.** Every route pays a few kilobytes of markup and ~2 KB gzipped of CSS it will not use. That is the price of the static copy being styled at first paint, and it is smaller than the round trip it removes.
