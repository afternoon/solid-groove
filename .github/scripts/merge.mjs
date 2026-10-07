#!/usr/bin/env node
// Merge what the product owner approved, a whole stack at a time.
//
//   node .github/scripts/merge.mjs issue <n>   `status:approved` went on issue <n>:
//                                              approve every open PR that refers to it,
//                                              and every PR stacked under those.
//   node .github/scripts/merge.mjs pr <n>      `status:approved` went on PR <n>:
//                                              approve it and every PR stacked under it.
//   node .github/scripts/merge.mjs sync <n>    PR <n> moved (pushed, or retargeted when
//                                              the PR under it merged): queue it if it
//                                              is approved and now sits on main.
//
// Approving labels each PR `status:approved` too. Only a PR on `main` can be queued, so the
// bottom of a stack is queued at once and each PR above it is queued by `sync`
// when restack.yml moves it onto `main`. Queuing is auto-merge: with the merge
// queue on, GitHub queues the PR once its checks pass, tests it on top of
// everything ahead of it, and merges it. ci-failure.yml handles a PR the queue
// throws out.
//
// The PRs are authored as the product owner (RESTACK_TOKEN), and GitHub does not
// let anyone approve their own PR, so the signal is a label, not a review.
import { execFileSync } from "node:child_process";
import { chainThrough } from "./stack-link.mjs";

const REPO = process.env.GITHUB_REPOSITORY;
const APPROVED = "status:approved";
const BASE = "main";

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
      "number,headRefName,baseRefName,isCrossRepository,body,labels",
    ]),
  ).filter((p) => !p.isCrossRepository);
  const byHead = new Map(prs.map((p) => [p.headRefName, p]));
  const byBase = new Map();
  for (const p of prs)
    byBase.set(p.baseRefName, [...(byBase.get(p.baseRefName) ?? []), p]);
  return { prs, byHead, byBase };
}

/** True when a PR body closes or refers to the issue (`Closes #12`, `Refs #12`). */
export function refersTo(body, issue) {
  return new RegExp(
    `\\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?)\\s+#${issue}(?!\\d)`,
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

function main() {
  const [mode, arg] = process.argv.slice(2);
  const n = Number(arg);
  const index = openPrs();
  if (mode === "issue") approve(approvalOfIssue(n, index), index);
  else if (mode === "pr") approve(approvalOf(n, index), index);
  else if (mode === "sync") {
    const p = index.prs.find((p) => p.number === n);
    const approved = p?.labels.some((l) => l.name === APPROVED);
    if (p && approved && p.baseRefName === BASE) queue(n);
    else
      console.log(
        `#${n}: not queued (approved: ${Boolean(approved)}, base: ${p?.baseRefName})`,
      );
  } else {
    console.error("usage: merge.mjs issue <n> | pr <n> | sync <n>");
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
