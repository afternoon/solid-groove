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
  {
    label: "status:approved",
    title: "Approved",
    color: "006B75",
    about:
      "Product owner approved; merge.yml queues its PRs and the merge queue lands them",
  },
];
const STATUS = new Set(COLUMNS.map((c) => c.label));
const BOARD_LABEL = "board";
/**
 * Pinned record issues that are not cards: the Board itself, and the QA
 * sweep's run log (`.github/workflows/qa-sweep.yml`).
 */
const OFF_BOARD = new Set([BOARD_LABEL, "qa-sweep"]);

/**
 * A GitHub outage or rate limit, not a real failure: worth another try. A 503
 * from the GraphQL API once crashed the status job mid-move, so a card stayed
 * in Ready and `/ship` never started.
 */
const TRANSIENT =
  /HTTP (5\d\d|429)|No server is currently available|secondary rate limit|timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection reset/i;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Run `gh`, retrying transient GitHub failures; any other failure throws at once. */
const gh = (args, input) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync("gh", args, {
        encoding: "utf8",
        input,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const stderr = String(error.stderr ?? "");
      if (stderr) process.stderr.write(stderr);
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !TRANSIENT.test(stderr)) throw error;
      console.warn(
        `gh ${args[0]} ${args[1] ?? ""}: transient failure, retrying in ${delay / 1000}s`,
      );
      sleep(delay);
    }
  }
};
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

/** An issue's labels and state, or null if it does not exist (or is a PR). */
function issueLabels(number) {
  try {
    return JSON.parse(
      gh(["issue", "view", String(number), "--repo", REPO, "--json", "labels,state"]),
    );
  } catch {
    return null;
  }
}

/** The status labels added to an issue, oldest first, or null if unreadable. */
function statusHistory(number) {
  try {
    return JSON.parse(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${REPO}/issues/${number}/events?per_page=100`,
      ]),
    )
      .flat()
      .filter((e) => e.event === "labeled" && STATUS.has(e.label?.name))
      .map((e) => e.label.name);
  } catch {
    return null;
  }
}

/** Of the status labels an issue carries, the one added most recently. */
function latestStatus(number, currentLabels) {
  const present = currentLabels.filter((l) => STATUS.has(l));
  if (present.length < 2) return present[0];
  return (statusHistory(number) ?? []).findLast((l) => present.includes(l));
}

/** Open PRs whose body closes the issue, with their comments. */
function closingPrs(number) {
  try {
    return JSON.parse(
      gh([
        "pr",
        "list",
        "--repo",
        REPO,
        "--state",
        "open",
        "--search",
        `${number} in:body`,
        "--json",
        "number,body,comments",
      ]),
    ).filter((pr) => closedBy(pr.body).includes(number));
  } catch {
    return [];
  }
}

const REWORK_GRACE_MS = 15 * 60 * 1000;

/**
 * Whether moving an issue to In progress sent it back for more work: its PRs
 * are already open, and it did not just come from Ready (that is /ship
 * starting). Returns the PR numbers to rework, or null. A recent `@claude`
 * comment on one of them means a Claude run is already on it (QA's fail
 * report is one), so that is left alone too.
 */
function sentBack(number) {
  const history = statusHistory(number);
  if (!history || history.at(-2) === "status:ready") return null;
  const prs = closingPrs(number);
  if (!prs.length) return null;
  const now = Date.now();
  const handled = prs.some((pr) =>
    (pr.comments ?? []).some(
      (c) =>
        c.body.includes("@claude") && now - Date.parse(c.createdAt) < REWORK_GRACE_MS,
    ),
  );
  return handled ? null : prs.map((pr) => pr.number);
}

/**
 * Issues a PR body closes: "Closes #12", "fixes #3", "Resolves #45". Code
 * spans and blocks are skipped, as GitHub skips them: a body that quotes
 * "`Closes #12`" as an example does not close #12.
 */
const closedBy = (body) => {
  const prose = (body ?? "").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [
    ...prose.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi),
  ].map((m) => Number(m[1]));
};

/** Issues a PR body says it completes (`Completes #12`): not a closing keyword, so the issue stays open for QA. */
const completedBy = (body) => {
  const prose = (body ?? "").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\bcompletes?\s+#(\d+)/gi)].map((m) => Number(m[1]));
};

const RULES_FILES = new Set(["firestore.rules", "storage.rules"]);

function changesRules(pr) {
  try {
    const { files } = JSON.parse(
      gh(["pr", "view", String(pr), "--repo", REPO, "--json", "files"]),
    );
    return files.some((f) => RULES_FILES.has(f.path));
  } catch {
    // If the files can't be read, assume the normal path: QA.
    return false;
  }
}

function status() {
  const name = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  ensureLabels();

  if (name === "issues") {
    const issue = event.issue;
    if (issue.pull_request || issue.labels.some((l) => OFF_BOARD.has(l.name))) return;
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
      // Runs queue, so this event may be handled after newer label changes.
      // Read the labels fresh and keep whichever status was added last, or a
      // late run moves the card back (QA passes, then an old in-progress
      // event lands and undoes it).
      const fresh = issueLabels(issue.number);
      const current = fresh ? fresh.labels.map((l) => l.name) : labels;
      if (!current.includes(event.label.name)) return;
      const target = latestStatus(issue.number, current) ?? event.label.name;
      setStatus(issue.number, target, current);
      if (target === "status:in-progress" && event.label.name === target) {
        const prs = sentBack(issue.number);
        if (prs) {
          appendFileSync(process.env.GITHUB_OUTPUT, `rework=${issue.number}\n`);
          appendFileSync(process.env.GITHUB_OUTPUT, `rework_prs=${prs.join(" ")}\n`);
        }
      }
    }
    return;
  }

  if (name === "pull_request") {
    const pr = event.pull_request;
    // The PR that completes an issue merged on its own (merge.yml queues safe
    // PRs without an approval), so the issue is QA'd on production, after the
    // deploy: its card goes to QA.
    if (pr.merged) {
      for (const number of completedBy(pr.body)) {
        const issue = issueLabels(number);
        if (issue?.state !== "OPEN") continue;
        setStatus(
          number,
          "status:qa",
          issue.labels.map((l) => l.name),
        );
      }
      return;
    }
    if (pr.draft) return;
    // A PR that closes an issue puts its card in QA, unless it changes the
    // security rules: those never get a preview deploy, so the QA bot never
    // sees them, and the card goes straight to review.
    const target = changesRules(pr.number) ? "status:review" : "status:qa";
    for (const number of closedBy(pr.body)) {
      const issue = issueLabels(number);
      if (issue?.state !== "OPEN") continue;
      setStatus(
        number,
        target,
        issue.labels.map((l) => l.name),
      );
    }
  }
}

// ---------------------------------------------------------------- render

const ISSUES = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(states:OPEN,first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{number title updatedAt milestone{title number}labels(first:30){nodes{name}}closedByPullRequestsReferences(first:3,includeClosedPrs:false){nodes{number}}}}}}`;

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
    milestone: i.milestone,
    prs: i.closedByPullRequestsReferences.nodes.map((p) => p.number),
  }));
}

/**
 * When an issue carries more than one status label, the latest stage wins.
 * Blocked beats everything, because it is the flag that asks for a person.
 */
const PRECEDENCE = [
  "status:blocked",
  "status:approved",
  "status:review",
  "status:qa",
  "status:in-progress",
  "status:ready",
  "status:backlog",
];

/** Leave every issue in exactly one column, repairing any that slipped. */
function normalise(issues) {
  for (const issue of issues) {
    const statuses = issue.labels.filter((l) => STATUS.has(l));
    if (statuses.length < 2) continue;
    const keep = PRECEDENCE.find((l) => statuses.includes(l));
    setStatus(issue.number, keep, issue.labels);
    issue.labels = issue.labels.filter((l) => !STATUS.has(l) || l === keep);
  }
}

function column(issue) {
  const status = issue.labels.find((l) => STATUS.has(l));
  if (status) return status;
  return issue.labels.includes("blocked") ? "status:blocked" : "status:backlog";
}

const SHAPING_LABEL = "needs-shaping";

/** Labels that mean the product owner has something to do; shown on the card. */
const ATTENTION_LABELS = [SHAPING_LABEL, "human-input-required"];

const needsShaping = (i) => (i.labels ?? []).includes(SHAPING_LABEL);
const attention = (i) => ATTENTION_LABELS.filter((l) => (i.labels ?? []).includes(l));

// GitHub expands "#123" in a list item into the issue's title and state. The
// issue's line carries its attention labels after the number, then each PR
// that closes it goes on a line of its own under it.
const line = (i) =>
  [
    [`- #${i.number}`, ...attention(i).map((l) => `\`${l}\``)].join(" "),
    ...(i.prs ?? []).map((n) => `  #${n}`),
  ].join("\n");

const BACKLOG_PER_MILESTONE = 10;

/**
 * The catch-all milestone, matched by title in any case: listed after every
 * other milestone. Everything else about milestones is read live, so they can
 * be added, renamed or renumbered freely.
 */
const isBacklog = (milestone) => milestone.title.trim().toLowerCase() === "backlog";

/**
 * Backlog groups in order: milestones by title ("M2" before "M10"), then
 * Backlog, then cards with no milestone.
 */
function compareMilestones(a, b) {
  const rank = (m) => (!m ? 2 : isBacklog(m) ? 1 : 0);
  return (
    rank(a) - rank(b) ||
    (a && b ? a.title.localeCompare(b.title, "en", { numeric: true }) : 0)
  );
}

/** The backlog, one sub-heading per milestone in title order, then Backlog, then the rest. */
function backlogLines(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = card.milestone ? card.milestone.number : 0;
    if (!groups.has(key)) groups.set(key, { milestone: card.milestone, cards: [] });
    groups.get(key).cards.push(card);
  }
  // Issues waiting on the product owner lead their milestone, so the cap
  // below never hides one.
  for (const group of groups.values()) {
    group.cards.sort((a, b) => attention(b).length - attention(a).length);
  }
  const out = [];
  for (const { milestone, cards: group } of [...groups.values()].sort((a, b) =>
    compareMilestones(a.milestone, b.milestone),
  )) {
    const title = milestone ? milestone.title : "No milestone";
    out.push(`### ${title} (${group.length})`, "");
    out.push(...group.slice(0, BACKLOG_PER_MILESTONE).map(line));
    if (group.length > BACKLOG_PER_MILESTONE) {
      const scope = milestone ? `milestone:"${milestone.title}"` : "no:milestone";
      const query = `is:issue is:open ${scope} -label:status:ready -label:status:in-progress -label:status:qa -label:status:review -label:status:approved -label:status:blocked -label:board`;
      out.push(
        `- … and ${group.length - BACKLOG_PER_MILESTONE} more: [all](${search(query)})`,
      );
    }
    out.push("");
  }
  return out;
}
const search = (q) => `https://github.com/${REPO}/issues?q=${encodeURIComponent(q)}`;

function renderBody(issues, done, now) {
  const by = new Map(COLUMNS.map((c) => [c.label, []]));
  for (const i of issues) by.get(column(i)).push(i);

  const order = [
    "status:ready",
    "status:in-progress",
    "status:qa",
    "status:review",
    "status:approved",
    "status:blocked",
    "status:backlog",
  ];
  const out = [];
  for (const label of order) {
    const col = COLUMNS.find((c) => c.label === label);
    const cards = by.get(label);
    if (label === "status:backlog") {
      const shaping = cards.filter(needsShaping).length;
      out.push(
        `## ${col.title} (${cards.length}${shaping ? `, ${shaping} need shaping` : ""})`,
        "",
      );
      out.push(...(cards.length ? backlogLines(cards) : ["_Empty_", ""]));
      continue;
    }
    out.push(`## ${col.title} (${cards.length})`, "");
    out.push(...(cards.length ? cards.map(line) : ["_Empty_"]), "");
  }
  out.push(
    `## Done this week (${done.length})`,
    "",
    ...(done.length ? done.map(line) : ["_Nothing yet_"]),
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
  ).filter((i) => !i.labels.some((l) => OFF_BOARD.has(l.name)));
  const issues = openIssues().filter((i) => !i.labels.some((l) => OFF_BOARD.has(l)));
  normalise(issues);
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
