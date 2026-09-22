#!/usr/bin/env node
// Emits `dist/client/app.html`: the shell every path that is not `/` is served
// (task #297).
//
//   node scripts/emit-app-shell.mjs [dir]
//
// `@solidjs/vite-plugin`'s client start mode prerenders `src/Document.tsx` once,
// into `dist/client/index.html`, and its generated server entry renders
// `<Document />` with **no request** — so the shell cannot know which path it is
// being served for. Since that one document now carries the marketing page's
// markup and metadata (which is the point: `/` has to be indexable and paint
// before its JavaScript), every deep link would otherwise be served a few
// kilobytes of marketing HTML that it discards, under a canonical URL and an
// `og:` card that describe a page the visitor did not ask for.
//
// So the split happens here instead: everything the document marked
// `data-landing="true"` is removed, and what remains is the same shell as
// before this task — an empty body, the entry script, and the stylesheet — with
// the app's own title. `firebase.json` serves `/` from `index.html` and
// everything else from `app.html`.
//
// The dev server and `vite preview` still serve one shell by history fallback;
// the inline script in the document covers them, removing the markup during
// parse. `scripts/verify-landing-static.mjs` checks both halves of this.
//
// Parsed rather than pattern-matched: the landing block is a tree of nested
// elements, and a regex cannot find its closing tag without counting. `jsdom`
// is already a devDependency (it is what the component suite runs in), and a
// build always has devDependencies installed.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { APP_TITLE } from "../site.config.mjs";

const dir = process.argv[2] ?? "dist/client";
const source = join(dir, "index.html");
const target = join(dir, "app.html");

const dom = new JSDOM(readFileSync(source, "utf8"));
const { document } = dom.window;

const landing = document.querySelectorAll('[data-landing="true"]');
if (landing.length === 0) {
  // Never a silent pass: if the document stopped marking its landing-only
  // nodes, this script would happily write a byte-identical app.html and the
  // marketing markup would ship on every deep link.
  console.error(
    `emit-app-shell — ${source} contains no [data-landing="true"] nodes. ` +
      "Did `src/Document.tsx` stop marking them?",
  );
  process.exit(1);
}
for (const node of landing) node.remove();

const title = document.createElement("title");
title.textContent = APP_TITLE;
// After the charset declaration, which browsers require inside the first 1024
// bytes of the document -- prepending would push it along by the title's width.
const charset = document.head.querySelector("meta[charset]");
if (charset) charset.after(title);
else document.head.prepend(title);

writeFileSync(target, dom.serialize());
console.log(
  `emit-app-shell — wrote ${target} (${landing.length} landing nodes removed).`,
);
