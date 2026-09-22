import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, SITE_TITLE } from "../site.config.mjs";
import LandingPageContent from "./components/LandingPageContent";

/**
 * The document shell, and with it the statically generated landing page
 * (task `#297`, PRD `PRJ-06`).
 *
 * `@solidjs/vite-plugin`'s client start mode prerenders this once, through the
 * built handler, into `dist/client/index.html`. **The application still never
 * renders on the server** — the plugin's generated entry renders `<Document />`
 * alone and the app is `render()`ed on the client, exactly as ADR 0005 decided.
 * What is new is that the shell is no longer empty: it carries the marketing
 * page's markup and its metadata, so `/` has something to show, something to
 * index, and something to unfurl before any JavaScript has run.
 *
 * ## Why the landing markup is safe to render here, and nothing else is
 *
 * This module is server code. Everything it imports is evaluated in a Node
 * build, so it may not touch the browser, Firebase, Tone, or the consent store.
 * `LandingPageContent` was extracted for exactly this reason: it is markup and
 * copy with no imports of its own beyond Solid, and it is the same component
 * the live page renders, so the prerendered HTML cannot drift from the app's.
 * The footer's telemetry disclosure is left out — it reads the consent store —
 * and the client fills it in on mount.
 *
 * ## One shell, two documents
 *
 * The generated entry renders `<Document />` with no request, so the shell
 * cannot know which path it is being served for. That is handled downstream
 * instead, in two layers that agree:
 *
 * 1. **In production**, `scripts/emit-app-shell.mjs` slices the two regions
 *    marked below out of the built `index.html` and writes the remainder as
 *    `app.html`. `firebase.json` serves `/` from the first and every other
 *    path from the second, so a deep link never pays for marketing markup it
 *    will discard.
 * 2. **Everywhere else** — the dev server and `vite preview`, which serve one
 *    shell by history fallback — the inline script below removes the markup
 *    during parse, before first paint, when the path is not `/`.
 *
 * Every landing-only node carries `data-landing="true"`, which is the contract
 * between this file and that script: it removes exactly those, and nothing
 * else. A tag added here without the attribute silently leaks into the app
 * shell, which is what `scripts/verify-landing-static.mjs` exists to catch.
 */

/**
 * Removes the prerendered landing markup when the shell is serving a deep link.
 *
 * Inlined and parser-blocking on purpose: it must run before the browser paints,
 * or a visitor opening a project would see the marketing page flash first. It is
 * the only inline script in the document, and it reads nothing but the path.
 */
const REMOVE_WHEN_NOT_LANDING = `if(location.pathname!=="/"){var e=document.getElementById("landing-static");if(e)e.remove()}`;

export default function Document() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title data-landing="true">{SITE_TITLE}</title>
        <meta data-landing="true" name="description" content={SITE_DESCRIPTION} />
        <link data-landing="true" rel="canonical" href={`${SITE_ORIGIN}/`} />
        <meta data-landing="true" property="og:type" content="website" />
        <meta data-landing="true" property="og:site_name" content={SITE_NAME} />
        <meta data-landing="true" property="og:title" content={SITE_TITLE} />
        <meta data-landing="true" property="og:description" content={SITE_DESCRIPTION} />
        <meta data-landing="true" property="og:url" content={`${SITE_ORIGIN}/`} />
        {/* No `og:image`: the alpha has no artwork that is true to what it
            ships, and the design mock shows capabilities it has not built
            (PRD `PRJ-06`). A text-only card is honest; `summary_large_image`
            with nothing to show is not. */}
        <meta data-landing="true" name="twitter:card" content="summary" />
        <meta data-landing="true" name="twitter:title" content={SITE_TITLE} />
        <meta data-landing="true" name="twitter:description" content={SITE_DESCRIPTION} />
      </head>
      <body>
        <div id="landing-static" data-landing="true">
          <LandingPageContent />
        </div>
        {/* `innerHTML` rather than a text child, which Solid's SSR would
            escape. The content is the module-level constant above -- not input
            of any kind -- and it has to be inline to run before first paint. */}
        <script data-landing="true" innerHTML={REMOVE_WHEN_NOT_LANDING} />
      </body>
    </html>
  );
}
