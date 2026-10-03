#!/usr/bin/env node
// Link a chain of stacked PRs into one of GitHub's native stacks, so the PR
// page shows the stack and it merges bottom-up from there.
//
//   node .github/scripts/stack-link.mjs <pr>
//
// Agents stack PRs the plain way (each PR's base is the previous PR's branch);
// this finds the whole chain that PR sits in and creates the native stack, or
// appends the new PRs to the stack it already has. It goes over REST
// (POST /repos/{o}/{r}/stacks), so nothing needs the `gh stack` extension.
//
// It only ever creates or appends. A chain that forks (two open PRs on one
// branch) is linked up to the fork, and a stack that disagrees with the chain
// is reported, not rewritten: unstacking is a person's call.
import { execFileSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const pr = Number(process.argv[2]);

const gh = (args, input) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  }).trim();
const api = (path, body) =>
  JSON.parse(
    body === undefined
      ? gh(["api", path])
      : gh(["api", "--method", "POST", path, "--input", "-"], JSON.stringify(body)) ||
          "null",
  );

/** Open, same-repo PRs, keyed both ways: by head branch and by base branch. */
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
      "number,headRefName,baseRefName,isCrossRepository",
    ]),
  ).filter((p) => !p.isCrossRepository);
  const byHead = new Map(prs.map((p) => [p.headRefName, p]));
  const byBase = new Map();
  for (const p of prs)
    byBase.set(p.baseRefName, [...(byBase.get(p.baseRefName) ?? []), p]);
  return { prs, byHead, byBase };
}

/** The chain through `number`, bottom to top. */
export function chainThrough(number, { prs, byHead, byBase }) {
  const start = prs.find((p) => p.number === number);
  if (!start) return [];
  const chain = [start];
  const seen = new Set([start.number]);
  for (let cur = start; byHead.has(cur.baseRefName); ) {
    cur = byHead.get(cur.baseRefName);
    if (seen.has(cur.number)) break;
    seen.add(cur.number);
    chain.unshift(cur);
  }
  for (let cur = start; (byBase.get(cur.headRefName) ?? []).length === 1; ) {
    cur = byBase.get(cur.headRefName)[0];
    if (seen.has(cur.number)) break;
    seen.add(cur.number);
    chain.push(cur);
  }
  return chain.map((p) => p.number);
}

/** The native stack a PR is in, or null. A 404 means stacks are off for the repo. */
function stackOf(number) {
  const stacks = api(`repos/${REPO}/stacks?pull_request=${number}`);
  return stacks[0] ?? null;
}

/** What to do with a chain, given the stack (if any) its PRs are already in. */
export function plan(chain, stacks) {
  if (chain.length < 2) return { action: "none", why: "not stacked" };
  const distinct = [
    ...new Map(stacks.filter(Boolean).map((s) => [s.number, s])).values(),
  ];
  if (distinct.length === 0) return { action: "create", prs: chain };
  if (distinct.length > 1)
    return {
      action: "none",
      why: `chain spans stacks ${distinct.map((s) => s.number).join(", ")}`,
    };
  const stack = distinct[0];
  const open = stack.pull_requests.filter((p) => p.state === "open").map((p) => p.number);
  const prefix = open.every((n, i) => chain[i] === n);
  if (!prefix)
    return {
      action: "none",
      why: `stack ${stack.number} is [${open}], chain is [${chain}]`,
    };
  const delta = chain.slice(open.length);
  return delta.length
    ? { action: "add", stack: stack.number, prs: delta }
    : { action: "none", why: "up to date" };
}

function main() {
  const chain = chainThrough(pr, openPrs());
  let stacks;
  try {
    stacks = chain.map(stackOf);
  } catch (e) {
    if (String(e.stderr ?? e).includes("404")) {
      console.log("Stacked PRs are not enabled for this repository; nothing to link.");
      return;
    }
    throw e;
  }
  const step = plan(chain, stacks);
  if (step.action === "create") {
    const s = api(`repos/${REPO}/stacks`, { pull_requests: step.prs });
    console.log(`Created stack ${s?.number}: ${step.prs.join(" -> ")}`);
  } else if (step.action === "add") {
    api(`repos/${REPO}/stacks/${step.stack}/add`, { pull_requests: step.prs });
    console.log(`Added ${step.prs.join(", ")} to stack ${step.stack}`);
  } else {
    console.log(`#${pr}: nothing to link (${step.why})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
