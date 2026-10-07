#!/usr/bin/env node
// Merge PRs through the merge queue: safe ones on their own, the rest once the
// product owner approves them.
//
//   node .github/scripts/merge.mjs sync <n>    PR <n> opened or moved (pushed, or
//                                              retargeted onto main when the PR under it
//                                              merged): queue it if it sits on main and is
//                                              safe or approved; otherwise flag it.
//   node .github/scripts/merge.mjs issue <n>   `status:approved` went on issue <n>:
//                                              approve every open PR that refers to it,
//                                              and every PR stacked under those.
//   node .github/scripts/merge.mjs pr <n>      `status:approved` went on PR <n>:
//                                              approve it and every PR stacked under it.
//
// A PR is safe when it touches no GATED path: those change what is stored,
// who may read it, what runs server side, dependencies, or the automation
// itself, which no test fully covers. A safe PR is queued as soon as it is on
// main and not a draft or labelled `hold`; its issue is QA'd on production
// after it lands (board.mjs moves the card to QA when the PR that completes it
// merges). A gated PR is labelled `needs-approval` and its card goes to Ready
// for review until the product owner approves it.
//
// Only a PR on `main` can be queued, so a stack lands bottom-up: each PR above
// the bottom is checked by `sync` when restack.yml moves it onto `main`.
// Queuing is auto-merge: GitHub queues the PR once its checks pass, tests it on
// top of everything ahead of it, and merges it. ci-failure.yml handles a PR the
// queue throws out.
//
// The PRs are authored as the product owner (RESTACK_TOKEN), and GitHub does not
// let anyone approve their own PR, so the signal is a label, not a review.
import { execFileSync } from "node:child_process";
import { chainThrough } from "./stack-link.mjs";

const REPO = process.env.GITHUB_REPOSITORY;
const APPROVED = "status:approved";
const NEEDS_APPROVAL = "needs-approval";
const HOLD = "hold";
const BASE = "main";

/** Paths a PR may not merge on its own. Keep in step with CLAUDE.md, "Merging". */
const GATED = [
  /^firestore\.rules$/,
  /^storage\.rules$/,
  /^firestore\.indexes\.json$/,
  /^firebase\.json$/,
  /^src\/domain\//,
  /^src\/persistence\//,
  /^functions\//,
  /^package\.json$/,
  /^bun\.lockb?$/,
  /^release\.config\.mjs$/,
  /^\.github\//,
  /^\.claude\//,
];

/** The changed paths that keep a PR from merging on its own. */
export const gatedPaths = (paths) => paths.filter((p) => GATED.some((g) => g.test(p)));

const gh = (args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function openPrs() {
  const prs = JSON.parse(
    gh([
      "pr",
      "list",
      "--repo",
      REPO,
      "--state",
      "open",
      "--limit",
      "500",
      "--json",
      "number,headRefName,baseRefName,isCrossRepository,isDraft,body,labels",
    ]),
  ).filter((p) => !p.isCrossRepository);
  const byHead = new Map(prs.map((p) => [p.headRefName, p]));
  const byBase = new Map();
  for (const p of prs)
    byBase.set(p.baseRefName, [...(byBase.get(p.baseRefName) ?? []), p]);
  return { prs, byHead, byBase };
}

/** True when a PR body closes, completes or refers to the issue (`Closes #12`, `Completes #12`, `Refs #12`). */
export function refersTo(body, issue) {
  return new RegExp(
    `\\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?|completes?)\\s+#${issue}(?!\\d)`,
    "i",
  ).test(body ?? "");
}

/** The PRs approving `number` covers: it and the PRs stacked under it, bottom first. */
export function approvalOf(number, index) {
  const chain = chainThrough(number, index);
  return chain.slice(0, chain.indexOf(number) + 1);
}

/** Every PR an approval of `issue` covers, bottom of each stack first. */
export function approvalOfIssue(issue, index) {
  const covered = [];
  for (const p of index.prs.filter((p) => refersTo(p.body, issue)))
    for (const n of approvalOf(p.number, index))
      if (!covered.includes(n)) covered.push(n);
  return covered;
}

function queue(number) {
  try {
    // With a merge queue, GitHub ignores the method and uses the queue's own.
    gh(["pr", "merge", String(number), "--repo", REPO, "--auto", "--squash"]);
    console.log(`#${number}: queued`);
  } catch (e) {
    // Already queued or already auto-merging is fine. A PR in one of GitHub's
    // native stacks (stack-link.yml) cannot auto-merge at all: it merges from
    // the stack's own page, so that is reported, not failed. Anything else fails.
    const msg = String(e.stderr ?? e);
    if (/already|is in clean status/i.test(msg)) console.log(`#${number}: ${msg.trim()}`);
    else if (/not supported for stacked pull requests/i.test(msg))
      console.log(`#${number}: in a native stack; merge it from the stack's page`);
    else throw e;
  }
}

function approve(numbers, index) {
  if (numbers.length === 0) {
    console.log("No open PRs to approve.");
    return;
  }
  for (const n of numbers) {
    gh(["pr", "edit", String(n), "--repo", REPO, "--add-label", APPROVED]);
    console.log(`#${n}: approved`);
  }
  for (const n of numbers) {
    const p = index.prs.find((p) => p.number === n);
    if (p?.baseRefName === BASE) queue(n);
    else console.log(`#${n}: waits for the PR under it (${p?.baseRefName})`);
  }
}

/** The issues a PR body refers to, in any form. */
const issuesIn = (body) =>
  [
    ...(body ?? "").matchAll(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|completes?)\s+#(\d+)/gi,
    ),
  ].map((m) => Number(m[1]));

function changedPaths(number) {
  // REST, paginated: `gh pr view --json files` stops at 100 files, and a big
  // PR must not slip a gated path past the check.
  return gh([
    "api",
    "--paginate",
    `repos/${REPO}/pulls/${number}/files?per_page=100`,
    "--jq",
    ".[].filename",
  ])
    .split("\n")
    .filter(Boolean);
}

/** Hold a gated PR for approval, once: label it, say why, and move its card to Ready for review. */
function flag(p, gated) {
  if (p.labels.some((l) => l.name === NEEDS_APPROVAL)) return;
  try {
    gh([
      "label",
      "create",
      NEEDS_APPROVAL,
      "--repo",
      REPO,
      "--color",
      "D93F0B",
      "--description",
      "Touches a gated path; merges once the product owner approves it",
    ]);
  } catch {
    // It already exists.
  }
  gh(["pr", "edit", String(p.number), "--repo", REPO, "--add-label", NEEDS_APPROVAL]);
  const list = gated.map((f) => `- \`${f}\``).join("\n");
  gh([
    "pr",
    "comment",
    String(p.number),
    "--repo",
    REPO,
    "--body",
    `This PR changes gated paths, so it does not merge on its own:\n\n${list}\n\nIt joins the merge queue once its issue (or this PR) is labelled \`${APPROVED}\`.\n\n---\n_Posted by the merge workflow (\`.github/workflows/merge.yml\`)._`,
  ]);
  for (const issue of new Set(issuesIn(p.body)))
    gh(["issue", "edit", String(issue), "--repo", REPO, "--add-label", "status:review"]);
  console.log(`#${p.number}: needs approval (${gated.join(", ")})`);
}

function sync(n, index) {
  const p = index.prs.find((p) => p.number === n);
  const has = (name) => p?.labels.some((l) => l.name === name);
  if (!p) return console.log(`#${n}: not an open PR here`);
  if (p.isDraft) return console.log(`#${n}: draft; not queued`);
  if (p.baseRefName !== BASE)
    return console.log(`#${n}: waits for the PR under it (${p.baseRefName})`);
  if (has(HOLD)) return console.log(`#${n}: labelled ${HOLD}; not queued`);
  if (has(APPROVED)) return queue(n);
  const gated = gatedPaths(changedPaths(n));
  if (gated.length) return flag(p, gated);
  console.log(`#${n}: safe`);
  queue(n);
}

function main() {
  const [mode, arg] = process.argv.slice(2);
  const n = Number(arg);
  const index = openPrs();
  if (mode === "issue") approve(approvalOfIssue(n, index), index);
  else if (mode === "pr") approve(approvalOf(n, index), index);
  else if (mode === "sync") sync(n, index);
  else {
    console.error("usage: merge.mjs sync <n> | issue <n> | pr <n>");
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
