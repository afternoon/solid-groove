#!/usr/bin/env node
/**
 * Guard the 1:1 mapping between the core flows registered in
 * `docs/core-flows.md` and the E2E specs that reproduce them.
 *
 * Every core flow lives in `tests/e2e/emulator/flows/` and nowhere else
 * (`TEST-001`): a flow's outcome includes surviving a reload, which only a real
 * backend can answer.
 *
 * `docs/core-flows.md` is the durable QA record and the specification a feature
 * is accepted against, so the expensive failure is *silent drift*: a flow that
 * nobody ever wrote a test for, a spec asserting a journey the register no
 * longer describes, or a stack that landed with its flow parked at `test.fixme`
 * forever. None of those fail any existing suite — a skipped test is green.
 *
 * What is a hard failure here:
 *   - a flow ID in the register with no spec file, or a spec file with no entry
 *     in the register
 *   - a duplicated flow ID
 *   - a flow spec that never calls `walkthrough()`, which is what makes the PR
 *     walkthrough a byproduct of the test rather than a manual errand
 *
 * What is reported but does NOT fail: a flow still marked `test.fixme`. That is
 * the expected state between the first PR in a stack and the one that closes
 * the issue (see `docs/core-flows.md`, "Lifecycle of a flow"), so failing on it
 * would break the very model it exists to support. It is printed on every run
 * so an abandoned flow stays visible instead of going quiet.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTER = "docs/core-flows.md";
const SUITE = "tests/e2e/emulator/flows";
const FLOW_HEADING = /^### (CF-\d{3}) — (.+)$/gm;

const failures = [];
const notes = [];

/**
 * Both spec checks below look for a *call*, so they must not see comment prose.
 * This file's own example spec explains in a comment why it is not `test.fixme`,
 * and an earlier version of this check duly reported it as fixme'd. The `[^:]`
 * guard keeps `https://` inside a string literal from eating the rest of a line.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

if (!existsSync(REGISTER)) {
  console.error(`check-core-flows — ${REGISTER} is missing.`);
  process.exit(1);
}

// Registered flows. The template block in the register writes its ID as
// `CF-0NN`, which the three-digit pattern deliberately does not match.
const registered = new Map();
for (const [, id, title] of readFileSync(REGISTER, "utf8").matchAll(FLOW_HEADING)) {
  if (registered.has(id))
    failures.push(
      `${REGISTER}: flow ${id} is registered twice. IDs are stable and never reused.`,
    );
  else registered.set(id, title.trim());
}

if (registered.size === 0) notes.push(`${REGISTER} registers no flows yet.`);

// Specs on disk, keyed by the ID in their filename.
const specs = new Map();
for (const file of existsSync(SUITE) ? readdirSync(SUITE) : []) {
  const match = file.match(/^(CF-\d{3})\.spec\.ts$/);
  if (!match) {
    failures.push(
      `${join(SUITE, file)}: every file in a flows/ directory is one core-flow spec named for its ID, e.g. CF-001.spec.ts.`,
    );
    continue;
  }
  const [, id] = match;
  const path = join(SUITE, file);
  if (specs.has(id))
    failures.push(
      `${id} has two specs: ${specs.get(id).path} and ${path}. A flow has exactly one.`,
    );
  else specs.set(id, { path, code: stripComments(readFileSync(path, "utf8")) });
}

// A flow left behind in the retired mock flows directory would otherwise be
// invisible here: it is not in SUITE, so its ID reads as "registered with no
// spec" and the real cause — the wrong directory — goes unsaid.
const RETIRED_SUITE = "tests/e2e/mock/flows";
if (existsSync(RETIRED_SUITE))
  failures.push(
    `${RETIRED_SUITE} still exists. Every core flow lives in ${SUITE} (TEST-001), because a flow's outcome includes surviving a reload and the mock backend cannot answer one.`,
  );

for (const [id, title] of registered)
  if (!specs.has(id))
    failures.push(
      `${id} ("${title}") is registered in ${REGISTER} but has no spec. Add ${join(SUITE, `${id}.spec.ts`)}, marked test.fixme until it passes.`,
    );

for (const [id, spec] of specs) {
  if (!registered.has(id))
    failures.push(
      `${spec.path} reproduces ${id}, which is not registered in ${REGISTER}. Only the product owner adds a flow.`,
    );

  if (!/\bwalkthrough\s*\(/.test(spec.code))
    failures.push(
      `${spec.path} never calls walkthrough() — its PR walkthrough could only be captured by hand. Import it from tests/e2e/support/walkthrough and capture a step at each point a reviewer should see.`,
    );

  if (/\.fixme\s*\(/.test(spec.code))
    notes.push(
      `${id} is still test.fixme in ${spec.path} — in flight, or abandoned mid-stack.`,
    );
}

for (const note of notes) console.log(`  note: ${note}`);

if (failures.length > 0) {
  console.error(`\ncheck-core-flows — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(`check-core-flows — ${registered.size} flow(s), each with exactly one spec.`);
