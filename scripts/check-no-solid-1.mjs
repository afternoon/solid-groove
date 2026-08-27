#!/usr/bin/env node
/**
 * Fails if a Solid 1 idiom has come back.
 *
 * The Solid 2 migration removed a finite, enumerable set of APIs, and that is
 * the whole reason this file can exist: "did every forced change land" is not a
 * judgement call here, it is an assertion that a handful of patterns appear
 * zero times. A reviewer grepping once tells you about today. This tells you
 * the day someone reflexively types `onMount` in six months, when Solid 1 is
 * what their fingers still know and the surrounding code no longer explains
 * why it is wrong.
 *
 * Scope is deliberately narrow. Every rule below matches something that Solid
 * 2 **removed or renamed**, so a hit is always wrong -- never a style
 * preference, never "we'd rather you didn't". A rule that could produce a
 * defensible hit does not belong here; it belongs in review.
 *
 * Run by `bun run check` (so CI gates on it), or on its own:
 *
 *     bun run verify:no-solid-1
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Directories never worth walking: not ours, or generated. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
  ".vinxi",
  ".claude",
  "playwright-report",
  "test-results",
  "vitest-report",
  "public",
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

/**
 * One rule per removed or renamed API.
 *
 * `pattern` runs against a single line. `hint` is the whole error message a
 * developer gets, so it says what to do rather than only what is wrong -- the
 * point of failing here instead of at runtime is to spend someone's attention
 * once.
 *
 * `allow` lists paths where a match is legitimate. Keep it short and keep a
 * reason on each entry.
 */
const RULES = [
  {
    id: "solid-js/store",
    pattern: /from\s+["']solid-js\/store["']/,
    hint: "Store APIs (createStore, reconcile, snapshot, storePath) are exported from `solid-js` itself in 2.0. The `solid-js/store` subpath does not exist.",
  },
  {
    id: "solid-js/web",
    pattern: /from\s+["']solid-js\/web["']/,
    hint: "The DOM runtime moved to `@solidjs/web`.",
  },
  {
    id: "onMount",
    pattern: /\bonMount\s*\(/,
    hint: "`onMount` is `onSettled` in 2.0, and it returns its cleanup instead of nesting `onCleanup` inside.",
  },
  {
    id: "createResource",
    pattern: /\bcreateResource\s*\(/,
    hint: "`createResource` is gone. Use an async `createMemo` and, where the read happens in render, a `<Loading>` boundary.",
  },
  {
    id: "batch",
    pattern: /(?<![.\w])batch\s*\(/,
    hint: "Batching is automatic in 2.0 -- just drop the wrapper. `flush()` forces a synchronous apply and belongs in tests, not product code.",
  },
  {
    id: "createComputed",
    pattern: /\bcreateComputed\s*\(/,
    hint: "`createComputed` is gone. Use `createMemo` to derive, a split `createEffect` for a side effect, or function-form `createSignal` for derive-with-writeback.",
  },
  {
    id: "createMutable",
    pattern: /\bcreate(Mutable|Deferred|Selector)\s*\(/,
    hint: "`createMutable`, `createDeferred` and `createSelector` are gone. See the 2.0 migration guide for the replacement that fits.",
  },
  {
    id: "produce",
    pattern: /(?<![.\w])produce\s*\(/,
    hint: "Store setters are draft-first in 2.0 -- `produce` is the default behaviour, so the wrapper just goes.",
  },
  {
    id: "mergeProps/splitProps",
    pattern: /\b(mergeProps|splitProps)\s*\(/,
    hint: "`mergeProps` is `merge` (note: `undefined` now overrides rather than skips) and `splitProps` is `omit`.",
  },
  {
    id: "unwrap",
    pattern: /(?<![.\w])unwrap\s*\(/,
    hint: "`unwrap` is `snapshot`.",
  },
  {
    id: "Suspense/ErrorBoundary",
    pattern: /<\/?(Suspense|ErrorBoundary)[\s/>]/,
    hint: "`Suspense` is `Loading` and `ErrorBoundary` is `Errored`, both from `@solidjs/web`. `Errored`'s fallback receives an accessor: `err().message`.",
  },
  {
    id: "classList",
    pattern: /\bclassList=\{/,
    hint: 'The `classList` prop is gone. Use the array form: class={["base", { active: isActive() }]}.',
  },
  {
    id: "Context.Provider",
    pattern: /<[A-Z]\w*\.Provider[\s>]/,
    hint: "A context is its own provider in 2.0: `<Ctx value={v}>`, not `<Ctx.Provider value={v}>`.",
  },
  {
    id: "use: directive",
    pattern: /\suse:[a-zA-Z]/,
    hint: "`use:` directives are gone. Pass a directive factory to `ref` instead.",
  },
  {
    id: "on:/attr:/bool: namespace",
    pattern: /\s(on|oncapture|attr|bool):[a-zA-Z]/,
    hint: "The `on:`, `oncapture:`, `attr:` and `bool:` namespaces are gone. Use `onClick` for events, a ref callback for native listener options, and plain attributes otherwise.",
  },
  {
    id: "@solidjs/start",
    pattern: /from\s+["']@solidjs\/start/,
    hint: "There is no `@solidjs/start` for Solid 2, and there is not meant to be one -- its serving layer is a mode of `@solidjs/vite-plugin`. See ADR 0005.",
  },
  {
    id: "vinxi",
    pattern: /(?<![\w-])vinxi(?![\w-])/,
    hint: "vinxi was removed with SolidStart. The dev server and build are `vite`.",
    allow: [
      // The ADR that records why it went, and the migration notes explaining it.
      "docs/adr/0005-leaving-solidstart-for-the-vite-plugin.md",
    ],
  },
  {
    id: "solid-firebase",
    pattern: /["']solid-firebase["']/,
    hint: "`solid-firebase` was removed: its only use was a provider whose context nothing read. Repository subscriptions are the app's own.",
  },
  {
    id: "@sentry/solidstart",
    pattern: /@sentry\/solid(start)?/,
    hint: "Both `@sentry/solidstart` and `@sentry/solid` peer-depend on Solid 1. The SDK is `@sentry/browser`. See ADR 0005.",
    allow: [
      "docs/adr/0005-leaving-solidstart-for-the-vite-plugin.md",
      "docs/adr/0001-sentry-for-error-monitoring.md",
    ],
  },
];

/** Every source file under `dir`, recursively, skipping SKIP_DIRS. */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.test(entry)) yield full;
  }
}

const failures = [];

for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");

  for (const [i, line] of lines.entries()) {
    // A line that is only a comment documents the old API rather than using
    // it, which is exactly what the migration's explanatory comments do.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

    for (const rule of RULES) {
      if (rule.allow?.some((p) => rel === p || rel.startsWith(p))) continue;
      if (!rule.pattern.test(line)) continue;
      failures.push({ file: rel, line: i + 1, rule, text: line.trim() });
    }
  }
}

if (failures.length === 0) {
  console.log("check-no-solid-1 — no Solid 1 idioms found in src/.");
  process.exit(0);
}

console.error(
  `check-no-solid-1 — found ${failures.length} Solid 1 idiom(s) that Solid 2 removed:\n`,
);
const byRule = new Map();
for (const f of failures) {
  if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, { hint: f.rule.hint, hits: [] });
  byRule.get(f.rule.id).hits.push(f);
}
for (const [id, { hint, hits }] of byRule) {
  console.error(`  ${id}`);
  console.error(`    ${hint}`);
  for (const h of hits) console.error(`      ${h.file}:${h.line}  ${h.text}`);
  console.error("");
}
process.exit(1);
