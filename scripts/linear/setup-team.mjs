#!/usr/bin/env node
/**
 * Put the Linear team in the shape the workflow expects. Idempotent: run it
 * again after a change to `STATES` in `.github/scripts/linear.mjs` and it
 * only adds or renames what differs. See `docs/linear.md`.
 *
 *   node scripts/linear/setup-team.mjs [--dry-run]
 *
 * It:
 *   1. renames the team's default states onto the board's columns (Todo →
 *      Ready, In progress → In Progress) and creates the missing ones, in
 *      board order;
 *   2. makes Backlog the state a new issue starts in;
 *   3. creates the project milestones M1 … M8 (from GitHub's open milestones,
 *      read with `gh`, minus the catch-all "Backlog") on the Groove project;
 *   4. creates the labels the workflow and the migration use.
 *
 * Needs LINEAR_API_KEY, and `gh` for step 3 (skipped, with a note, if `gh`
 * cannot list the milestones).
 */

import { execFileSync } from "node:child_process";
import * as linear from "../../.github/scripts/linear.mjs";

const DRY = process.argv.includes("--dry-run");
const REPO = process.env.GITHUB_REPOSITORY ?? "trygroove/groove";

/** A default Linear state that becomes one of ours when the name differs. */
const RENAMES = new Map([
  ["todo", "Ready"],
  ["in progress", "In Progress"],
]);

/** Labels the automation writes or reads. The migration adds any others it meets. */
const LABELS = [
  "bug",
  "polish",
  "refactor",
  "contract",
  "decision",
  "documentation",
  "needs-shaping",
  "human-input-required",
  "parked",
];

const say = (line) => console.log(`${DRY ? "[dry-run] " : ""}${line}`);

async function setupStates() {
  const team = await linear.team();
  const existing = await linear.states();
  const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
  for (const [from, to] of RENAMES) {
    const s = byName.get(from);
    // A rename that only changes case targets the state itself, which does
    // not count as already taken.
    if (
      !s ||
      s.name === to ||
      (from !== to.toLowerCase() && byName.has(to.toLowerCase()))
    )
      continue;
    say(`rename state "${s.name}" → "${to}"`);
    if (!DRY)
      await linear.gql(
        `mutation($id:String!,$input:WorkflowStateUpdateInput!){workflowStateUpdate(id:$id,input:$input){workflowState{id}}}`,
        { id: s.id, input: { name: to } },
      );
    byName.delete(from);
    byName.set(to.toLowerCase(), { ...s, name: to });
  }
  for (const [index, wanted] of linear.STATES.entries()) {
    const s = byName.get(wanted.name.toLowerCase());
    const position = index + 1;
    if (s) {
      if (s.type !== wanted.type)
        console.warn(
          `state "${s.name}" is type ${s.type}, expected ${wanted.type}; Linear cannot change a state's type, so leave it or recreate it by hand`,
        );
      // Linear's Duplicate state is reserved: it refuses any update.
      if (s.position !== position && s.type !== "duplicate") {
        say(`reorder state "${s.name}" to ${position}`);
        if (!DRY)
          await linear.gql(
            `mutation($id:String!,$input:WorkflowStateUpdateInput!){workflowStateUpdate(id:$id,input:$input){workflowState{id}}}`,
            { id: s.id, input: { position } },
          );
      }
      continue;
    }
    say(`create state "${wanted.name}" (${wanted.type})`);
    if (!DRY)
      await linear.gql(
        `mutation($input:WorkflowStateCreateInput!){workflowStateCreate(input:$input){workflowState{id}}}`,
        {
          input: {
            teamId: team.id,
            name: wanted.name,
            type: wanted.type,
            color: wanted.color,
            description: wanted.about,
            position,
          },
        },
      );
  }
  const extra = existing.filter(
    (s) =>
      !linear.STATES.some((w) => w.name.toLowerCase() === s.name.toLowerCase()) &&
      !RENAMES.has(s.name.toLowerCase()),
  );
  for (const s of extra)
    console.warn(
      `state "${s.name}" is not a board column; delete it by hand if nothing uses it`,
    );
}

async function setDefaultState() {
  // Re-read: the states may have just been created.
  const data = await linear.gql(
    `query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id defaultIssueState{id}}} workflowStates(filter:{team:{key:{eq:$key}}},first:50){nodes{id name}}}`,
    { key: linear.TEAM_KEY },
  );
  const team = data.teams.nodes[0];
  const backlog = data.workflowStates.nodes.find(
    (s) => s.name.toLowerCase() === "backlog",
  );
  if (!backlog) throw new Error("no Backlog state");
  if (team.defaultIssueState?.id === backlog.id) return;
  say("make Backlog the default state for new issues");
  if (!DRY)
    await linear.gql(
      `mutation($id:String!,$input:TeamUpdateInput!){teamUpdate(id:$id,input:$input){team{id}}}`,
      {
        id: team.id,
        input: { defaultIssueStateId: backlog.id },
      },
    );
}

async function setupMilestones() {
  let titles;
  try {
    titles = JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          `repos/${REPO}/milestones?state=open&per_page=100`,
          "--jq",
          "[.[].title]",
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  } catch {
    console.warn("could not read GitHub's milestones with gh; skipping milestones");
    return;
  }
  const have = new Set((await linear.milestones()).map((m) => m.name.toLowerCase()));
  // Created in number order (M2 before M10), which is the order Linear lists them.
  const number = (t) => Number(/\d+/.exec(t)?.[0] ?? Number.POSITIVE_INFINITY);
  const ordered = titles
    .filter((t) => t.trim().toLowerCase() !== "backlog")
    .sort((a, b) => number(a) - number(b));
  for (const title of ordered) {
    if (have.has(title.toLowerCase())) continue;
    say(`create milestone "${title}"`);
    if (!DRY) await linear.milestoneNamed(title, { create: true });
  }
}

async function setupLabels() {
  const have = new Set((await linear.labels()).map((l) => l.name.toLowerCase()));
  for (const name of LABELS) {
    if (have.has(name)) continue;
    say(`create label "${name}"`);
    if (!DRY) await linear.labelNamed(name, { create: true });
  }
}

async function main() {
  const project = await linear.project();
  console.log(`Team ${linear.TEAM_KEY}, project "${project.name}" (${project.url})`);
  await setupStates();
  await setDefaultState();
  await setupMilestones();
  await setupLabels();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
