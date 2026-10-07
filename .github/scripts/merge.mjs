#!/usr/bin/env node
// Merge PRs through the merge queue: safe ones on their own, the rest once the
// product owner approves them.
//
//   node .github/scripts/merge.mjs sync <n>       PR <n> opened or was pushed: queue it if
//                                                 it is safe or approved; otherwise flag it.
//   node .github/scripts/merge.mjs issue GRV-12   The card is in Approved (board.mjs calls this
//                                                 on every poll): approve every open PR that
//                                                 refers to it and is not approved yet.
//   node .github/scripts/merge.mjs pr <n>         `status:approved` went on PR <n>: approve it.
//
// A PR is safe when it touches no GATED path: those change what is stored,
// who may read it, what runs server side, dependencies, or the automation
// itself, which no test fully covers. A safe PR is queued as soon as it is on
// main and not a draft or labelled `hold`; its card is QA'd on production
// after it lands (board.mjs moves the card to QA when the PR that completes it
// merges). A gated PR is labelled `needs-approval` and its card goes to Ready
// for review until the product owner moves it to Approved.
//
// Every PR targets `main` (there are no stacked PRs; a card that needs more
// than one PR lands them in sequence, each after the last merged). Queuing is
// auto-merge: GitHub queues the PR once its checks pass, tests it on top of
// everything ahead of it, and merges it. ci-failure.yml handles a PR the queue
// throws out, and conflicts.yml a PR that `main` moved out from under.
//
// The PRs are authored as the product owner (RESTACK_TOKEN), and GitHub does not
// let anyone approve their own PR, so the signal is a column (or a label on
// the PR), not a review.
import { execFileSync } from "node:child_process";
import * as linear from "./linear.mjs";

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

/** Every open PR from this repo, with the fields the board and the queue read. */
export function openPrs() {
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
      "number,headRefName,baseRefName,isCrossRepository,isDraft,body,labels,comments",
    ]),
  ).filter((p) => !p.isCrossRepository);
  return { prs };
}

/** True when a PR body closes, completes or refers to the card (`Closes GRV-12`, `Completes GRV-12`, `Refs GRV-12`). */
export function refersTo(body, issue) {
  return new RegExp(
    `\\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?|completes?)\\s+${issue}(?!\\d)`,
    "i",
  ).test(body ?? "");
}

/** The PRs approving `number` covers: that PR, if it is open here. */
export function approvalOf(number, index) {
  return index.prs.some((p) => p.number === number) ? [number] : [];
}

/** Every open PR an approval of the card covers: each one whose body refers to it and is not approved yet. */
export function approvalOfIssue(issue, index) {
  return index.prs
    .filter((p) => refersTo(p.body, issue) && !p.labels.some((l) => l.name === APPROVED))
    .map((p) => p.number);
}

function queue(number) {
  try {
    // With a merge queue, GitHub ignores the method and uses the queue's own.
    gh(["pr", "merge", String(number), "--repo", REPO, "--auto", "--squash"]);
    console.log(`#${number}: queued`);
  } catch (e) {
    // Already queued or already auto-merging is fine. Anything else fails.
    const msg = String(e.stderr ?? e);
    if (/already|is in clean status/i.test(msg)) console.log(`#${number}: ${msg.trim()}`);
    else throw e;
  }
}

export function approve(numbers, index) {
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
    else
      console.log(`#${n}: not on ${BASE} (${p?.baseRefName}); retarget it onto ${BASE}`);
  }
}

/** The cards a PR body refers to, in any form. */
export const issuesIn = (body) =>
  [
    ...(body ?? "").matchAll(
      new RegExp(
        `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|completes?)\\s+(${linear.TEAM_KEY}-\\d+)\\b`,
        "gi",
      ),
    ),
  ].map((m) => m[1].toUpperCase());

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
async function flag(p, gated) {
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
    `This PR changes gated paths, so it does not merge on its own:\n\n${list}\n\nIt joins the merge queue once its card is moved to **Approved** in Linear (or this PR is labelled \`${APPROVED}\`).\n\n---\n_Posted by the merge workflow (\`.github/workflows/merge.yml\`)._`,
  ]);
  for (const issue of new Set(issuesIn(p.body))) {
    try {
      await linear.setState(issue, "Ready for review");
    } catch (error) {
      console.warn(`${issue}: could not move to Ready for review: ${error.message}`);
    }
  }
  console.log(`#${p.number}: needs approval (${gated.join(", ")})`);
}

async function sync(n, index) {
  const p = index.prs.find((p) => p.number === n);
  const has = (name) => p?.labels.some((l) => l.name === name);
  if (!p) return console.log(`#${n}: not an open PR here`);
  if (p.isDraft) return console.log(`#${n}: draft; not queued`);
  if (p.baseRefName !== BASE)
    return console.log(
      `#${n}: not on ${BASE} (${p.baseRefName}); retarget it onto ${BASE}`,
    );
  if (has(HOLD)) return console.log(`#${n}: labelled ${HOLD}; not queued`);
  if (has(APPROVED)) return queue(n);
  const gated = gatedPaths(changedPaths(n));
  if (gated.length) return flag(p, gated);
  console.log(`#${n}: safe`);
  queue(n);
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  const index = openPrs();
  if (mode === "issue") approve(approvalOfIssue(arg.toUpperCase(), index), index);
  else if (mode === "pr") approve(approvalOf(Number(arg), index), index);
  else if (mode === "sync") await sync(Number(arg), index);
  else {
    console.error("usage: merge.mjs sync <n> | issue <GRV-id> | pr <n>");
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
