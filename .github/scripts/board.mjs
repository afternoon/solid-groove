#!/usr/bin/env node
/**
 * The task board: `status:*` labels on issues, and one pinned "Board" issue
 * that lists them by column. Run by `.github/workflows/board.yml`.
 *
 *   node board.mjs status   Apply the label rules for the triggering event.
 *                           Writes `ship=<issue>` to $GITHUB_OUTPUT when a card
 *                           moved to Ready and should be shipped.
 *   node board.mjs render   Rewrite the Board issue from the current labels.
 *
 * A card is in exactly one column. Adding any `status:*` label removes the
 * others, so a person, an agent or the QA bot only ever adds the new one.
 * Done is not a label: a closed issue is done.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY;
const [OWNER, NAME] = REPO.split("/");

const COLUMNS = [
  {
    label: "status:backlog",
    title: "Backlog",
    color: "EDEDED",
    about: "Not ready to start",
  },
  {
    label: "status:ready",
    title: "Ready",
    color: "0E8A16",
    about: "Spec agreed; moving here starts /ship",
  },
  {
    label: "status:in-progress",
    title: "In progress",
    color: "FBCA04",
    about: "An agent is building it",
  },
  {
    label: "status:blocked",
    title: "Blocked",
    color: "B60205",
    about: "Waiting on an answer or decision",
  },
  {
    label: "status:qa",
    title: "QA",
    color: "1D76DB",
    about: "PR is up; preview QA is running",
  },
  {
    label: "status:review",
    title: "Ready for review",
    color: "5319E7",
    about: "QA passed; final pass before merge",
  },
];
const STATUS = new Set(COLUMNS.map((c) => c.label));
const BOARD_LABEL = "board";

const gh = (args, input) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  }).trim();
const graphql = (query, vars = {}) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars))
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  return JSON.parse(gh(args)).data;
};

function ensureLabels() {
  const have = new Set(
    JSON.parse(
      gh(["label", "list", "--repo", REPO, "--limit", "500", "--json", "name"]),
    ).map((l) => l.name),
  );
  for (const c of COLUMNS)
    if (!have.has(c.label))
      gh([
        "label",
        "create",
        c.label,
        "--repo",
        REPO,
        "--color",
        c.color,
        "--description",
        c.about,
      ]);
  if (!have.has(BOARD_LABEL))
    gh([
      "label",
      "create",
      BOARD_LABEL,
      "--repo",
      REPO,
      "--color",
      "000000",
      "--description",
      "The pinned task board",
    ]);
}

/** Put an issue in one column: add `label` (if any), remove every other status label. */
function setStatus(number, label, currentLabels) {
  const remove = currentLabels.filter((l) => STATUS.has(l) && l !== label);
  const args = ["issue", "edit", String(number), "--repo", REPO];
  if (label && !currentLabels.includes(label)) args.push("--add-label", label);
  for (const l of remove) args.push("--remove-label", l);
  if (args.length > 5) gh(args);
}

const issueLabels = (number) =>
  JSON.parse(
    gh(["issue", "view", String(number), "--repo", REPO, "--json", "labels,state"]),
  );

/** Issues a PR body closes: "Closes #12", "fixes #3", "Resolves #45". */
const closedBy = (body) =>
  [
    ...(body ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi),
  ].map((m) => Number(m[1]));

function status() {
  const name = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  ensureLabels();

  if (name === "issues") {
    const issue = event.issue;
    if (issue.pull_request || issue.labels.some((l) => l.name === BOARD_LABEL)) return;
    const labels = issue.labels.map((l) => l.name);
    const action = event.action;

    if (action === "closed") return setStatus(issue.number, null, labels);
    if (action === "opened" || action === "reopened") {
      if (!labels.some((l) => STATUS.has(l)))
        setStatus(issue.number, "status:backlog", labels);
      return;
    }
    if (action === "labeled" && STATUS.has(event.label.name)) {
      if (event.label.name === "status:ready") {
        // Ready is a request to start: hand it straight to /ship.
        setStatus(issue.number, "status:in-progress", labels);
        appendFileSync(process.env.GITHUB_OUTPUT, `ship=${issue.number}\n`);
        return;
      }
      setStatus(issue.number, event.label.name, labels);
    }
    return;
  }

  if (name === "pull_request") {
    const pr = event.pull_request;
    if (pr.draft || pr.merged) return;
    // A PR that closes an issue puts its card in QA.
    for (const number of closedBy(pr.body)) {
      const issue = issueLabels(number);
      if (issue.state !== "OPEN") continue;
      setStatus(
        number,
        "status:qa",
        issue.labels.map((l) => l.name),
      );
    }
  }
}

// ---------------------------------------------------------------- render

const ISSUES = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(states:OPEN,first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{number title updatedAt labels(first:30){nodes{name}}closedByPullRequestsReferences(first:3,includeClosedPrs:false){nodes{number}}}}}}`;

function openIssues() {
  const all = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const vars = { owner: OWNER, name: NAME };
    if (after) vars.after = after;
    const { issues } = graphql(ISSUES, vars).repository;
    all.push(...issues.nodes);
    if (!issues.pageInfo.hasNextPage) break;
    after = issues.pageInfo.endCursor;
  }
  return all.map((i) => ({
    number: i.number,
    title: i.title,
    labels: i.labels.nodes.map((l) => l.name),
    prs: i.closedByPullRequestsReferences.nodes.map((p) => p.number),
  }));
}

function column(issue) {
  const status = issue.labels.find((l) => STATUS.has(l));
  if (status) return status;
  return issue.labels.includes("blocked") ? "status:blocked" : "status:backlog";
}

const line = (i) =>
  `- #${i.number} ${i.title}${i.prs.length ? ` · PR ${i.prs.map((n) => `#${n}`).join(", ")}` : ""}`;
const search = (q) => `https://github.com/${REPO}/issues?q=${encodeURIComponent(q)}`;

function renderBody(issues, done, now) {
  const by = new Map(COLUMNS.map((c) => [c.label, []]));
  for (const i of issues) by.get(column(i)).push(i);

  const order = [
    "status:ready",
    "status:in-progress",
    "status:qa",
    "status:review",
    "status:blocked",
    "status:backlog",
  ];
  const out = [];
  for (const label of order) {
    const col = COLUMNS.find((c) => c.label === label);
    const cards = by.get(label);
    out.push(`## ${col.title} (${cards.length})`, "");
    const shown = label === "status:backlog" ? cards.slice(0, 15) : cards;
    out.push(...(shown.length ? shown.map(line) : ["_Empty_"]));
    if (shown.length < cards.length)
      out.push(
        `- … and ${cards.length - shown.length} more: [all backlog](${search("is:issue is:open -label:status:ready -label:status:in-progress -label:status:qa -label:status:review -label:status:blocked -label:board")})`,
      );
    out.push("");
  }
  out.push(
    `## Done this week (${done.length})`,
    "",
    ...(done.length ? done.map((i) => `- #${i.number} ${i.title}`) : ["_Nothing yet_"]),
    "",
  );
  out.push(
    "---",
    "",
    "Move a card by adding its `status:*` label; the old one is removed for you. **Ready** starts `/ship`. Closing an issue moves it to Done.",
    "",
    `<sub>Rewritten by \`.github/workflows/board.yml\` at ${now.toISOString().slice(0, 16).replace("T", " ")} UTC. Edits to this body are overwritten.</sub>`,
  );
  return out.join("\n");
}

function render() {
  ensureLabels();
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const done = JSON.parse(
    gh([
      "issue",
      "list",
      "--repo",
      REPO,
      "--state",
      "closed",
      "--search",
      `closed:>=${since} reason:completed`,
      "--limit",
      "100",
      "--json",
      "number,title,labels",
    ]),
  ).filter((i) => !i.labels.some((l) => l.name === BOARD_LABEL));
  const issues = openIssues().filter((i) => !i.labels.includes(BOARD_LABEL));
  const body = renderBody(issues, done, now);

  const existing = JSON.parse(
    gh([
      "issue",
      "list",
      "--repo",
      REPO,
      "--label",
      BOARD_LABEL,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "number",
    ]),
  );
  if (existing.length) {
    gh(
      ["issue", "edit", String(existing[0].number), "--repo", REPO, "--body-file", "-"],
      body,
    );
    return;
  }
  const url = gh(
    [
      "issue",
      "create",
      "--repo",
      REPO,
      "--title",
      "Board",
      "--label",
      BOARD_LABEL,
      "--body-file",
      "-",
    ],
    body,
  );
  const number = Number(url.split("/").pop());
  const { repository } = graphql(
    `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id}}}`,
    { owner: OWNER, name: NAME, number },
  );
  graphql(`mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{number}}}`, {
    id: repository.issue.id,
  });
}

const mode = process.argv[2];
if (mode === "status") status();
else if (mode === "render") render();
else {
  console.error("usage: board.mjs status|render");
  process.exit(2);
}
