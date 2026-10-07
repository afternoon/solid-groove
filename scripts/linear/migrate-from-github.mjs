#!/usr/bin/env node
/**
 * Copy every open GitHub issue into Linear, once. See `docs/linear.md`.
 *
 *   node scripts/linear/migrate-from-github.mjs [--dry-run] [--keep-ready] [--only 1105,1102]
 *
 * For each open issue in `trygroove/groove` that is not a pull request and
 * not the pinned Board:
 *
 *   - the title is kept; the body becomes the description, with every
 *     `#123` rewritten to the migrated issue's identifier (`GRV-45`) or, for
 *     an issue that was not migrated (closed, or a PR), a link to GitHub;
 *   - the issue's comments are folded in under a "Notes from GitHub" heading,
 *     each with its author and date, so nothing said on the issue is lost;
 *   - labels are copied, except the `status:*` and `board` ones;
 *   - the GitHub milestone becomes the project milestone of the same name
 *     (none for the catch-all "Backlog" milestone);
 *   - the column comes from the `status:*` label (the `blocked` label means
 *     Blocked); `status:ready` becomes Backlog unless `--keep-ready`, so the
 *     cutover does not start a build nobody asked for today;
 *   - the `blocked_by` graph becomes Linear blocking relations, between
 *     migrated issues only (a closed blocker is done);
 *   - the original's creation date is kept, and a footer links back to it.
 *
 * Idempotent: an issue whose footer is already in Linear is updated in place,
 * so the script can be run again after a partial run. Needs LINEAR_API_KEY
 * and `gh` (REST only).
 */

import { execFileSync } from "node:child_process";
import * as linear from "../../.github/scripts/linear.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "trygroove/groove";
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const KEEP_READY = argv.includes("--keep-ready");
const ONLY = (() => {
  const i = argv.indexOf("--only");
  return i === -1 ? null : new Set(argv[i + 1].split(",").map(Number));
})();

const STATUS_TO_STATE = new Map([
  ["status:backlog", "Backlog"],
  ["status:ready", KEEP_READY ? "Ready" : "Backlog"],
  ["status:in-progress", "In progress"],
  ["status:blocked", "Blocked"],
  ["status:qa", "QA"],
  ["status:review", "Ready for review"],
  ["status:approved", "Approved"],
]);
const SKIP_LABELS = new Set(["board", ...STATUS_TO_STATE.keys()]);
const OFF_BOARD = new Set(["board"]);

const gh = (path) =>
  JSON.parse(
    execFileSync("gh", ["api", "--paginate", "--slurp", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ).flat();

const footer = (n) =>
  `_Migrated from [${REPO}#${n}](https://github.com/${REPO}/issues/${n})._`;
const FOOTER_MARK = (n) => `${REPO}#${n}](`;

/** Open GitHub issues (not PRs, not the Board), oldest first. */
function githubIssues() {
  return gh(`repos/${REPO}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request)
    .filter((i) => !i.labels.some((l) => OFF_BOARD.has(l.name)))
    .filter((i) => !ONLY || ONLY.has(i.number))
    .sort((a, b) => a.number - b.number);
}

const comments = (n) => gh(`repos/${REPO}/issues/${n}/comments?per_page=100`);
const blockedBy = (n) => {
  try {
    return gh(`repos/${REPO}/issues/${n}/dependencies/blocked_by?per_page=100`).map(
      (i) => i.number,
    );
  } catch {
    return [];
  }
};

const stateFor = (labels) => {
  for (const l of labels) if (STATUS_TO_STATE.has(l)) return STATUS_TO_STATE.get(l);
  if (labels.includes("blocked")) return "Blocked";
  return "Backlog";
};

const milestoneFor = (issue) => {
  const title = issue.milestone?.title?.trim();
  return title && title.toLowerCase() !== "backlog" ? title : undefined;
};

/**
 * `#123` → `GRV-45` when #123 was migrated, else a GitHub link. Fenced code
 * and code spans are left alone. `GRV-45` is the issue's identifier; a link
 * is not needed, Linear links identifiers itself.
 */
export function rewriteRefs(text, map, repo = REPO) {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, k) => {
      if (k % 2 === 1) return part;
      return part.replace(/(^|[^\w/&])#(\d+)\b/g, (_match, before, n) => {
        const id = map.get(Number(n));
        if (id) return `${before}${id}`;
        return `${before}[#${n}](https://github.com/${repo}/issues/${n})`;
      });
    })
    .join("");
}

const when = (iso) => iso.slice(0, 10);

/**
 * GitHub's `<img src="…">` (how a pasted screenshot arrives) as a Markdown
 * image: Linear does not take raw HTML, and mangles the src into a link.
 */
export const imagesToMarkdown = (text) =>
  text.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc="([^"]+)"/i.exec(tag)?.[1];
    if (!src) return tag;
    const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] ?? "";
    return `![${alt}](${src})`;
  });

/** The description: the body, the comments folded in, the footer. Refs rewritten later. */
function describe(issue, notes) {
  const out = [imagesToMarkdown(issue.body?.trim() || "_(no description on GitHub)_")];
  if (notes.length) {
    out.push("", "---", "", "## Notes from GitHub", "");
    for (const c of notes)
      out.push(
        `**${c.user?.login ?? "someone"}, ${when(c.created_at)}:**`,
        "",
        imagesToMarkdown(c.body?.trim() || "_(empty)_"),
        "",
      );
  }
  out.push("", footer(issue.number));
  return out.join("\n");
}

/** The Linear issue already created for GitHub #n, if any. */
async function existing(n) {
  const data = await linear.gql(
    `query($filter:IssueFilter!){issues(filter:$filter,first:5){nodes{id identifier url description}}}`,
    {
      filter: {
        team: { key: { eq: linear.TEAM_KEY } },
        description: { contains: FOOTER_MARK(n) },
      },
    },
  );
  return data.issues.nodes.find((i) => i.description?.includes(FOOTER_MARK(n))) ?? null;
}

async function main() {
  const issues = githubIssues();
  console.log(
    `${issues.length} open issue(s) on GitHub to migrate into ${linear.TEAM_KEY}`,
  );
  const map = new Map(); // GitHub number -> Linear identifier
  const drafts = [];

  // Pass 1: create (or find) each issue with its raw body.
  for (const issue of issues) {
    const labels = issue.labels.map((l) => l.name).filter((l) => !SKIP_LABELS.has(l));
    const state = stateFor(issue.labels.map((l) => l.name));
    const milestone = milestoneFor(issue);
    const notes = issue.comments > 0 ? comments(issue.number) : [];
    const description = describe(issue, notes);
    const draft = {
      issue,
      labels,
      state,
      milestone,
      description,
      blockedBy: blockedBy(issue.number),
    };
    drafts.push(draft);
    const found = DRY ? null : await existing(issue.number);
    if (found) {
      map.set(issue.number, found.identifier);
      draft.identifier = found.identifier;
      console.log(`#${issue.number} is already ${found.identifier}; will update it`);
      continue;
    }
    console.log(
      `${DRY ? "[dry-run] " : ""}#${issue.number} → ${state}${milestone ? `, ${milestone}` : ""}${labels.length ? ` [${labels.join(", ")}]` : ""}: ${issue.title}`,
    );
    if (DRY) continue;
    const created = await linear.create({
      title: issue.title,
      body: description,
      state,
      labels,
      milestone,
      createdAt: issue.created_at,
    });
    map.set(issue.number, created.identifier);
    draft.identifier = created.identifier;
    console.log(`  created ${created.identifier} ${created.url}`);
  }

  // Pass 2: now every identifier is known, rewrite references, set the
  // column (an existing issue may have moved; the GitHub label is still the
  // source today), and add the blocking relations.
  for (const draft of drafts) {
    const { issue, identifier } = draft;
    const body = rewriteRefs(draft.description, map);
    if (DRY) {
      if (body !== draft.description)
        console.log(`[dry-run] #${issue.number}: references rewritten`);
      continue;
    }
    await linear.update(identifier, { description: body, title: issue.title });
    await linear.setState(identifier, draft.state);
    if (draft.milestone) await linear.setMilestone(identifier, draft.milestone);
    for (const name of draft.labels) await linear.addLabel(identifier, name);
    for (const n of draft.blockedBy) {
      const blocker = map.get(n);
      if (!blocker) continue; // closed (done) or not migrated
      await linear.relateBlocks(blocker, identifier);
      console.log(`  ${blocker} blocks ${identifier}`);
    }
  }

  const ready = drafts.filter((d) =>
    d.issue.labels.some((l) => l.name === "status:ready"),
  );
  if (ready.length && !KEEP_READY)
    console.log(
      `\n${ready.length} issue(s) were status:ready on GitHub and were put in Backlog, not Ready, so the cutover starts no build by itself: ${ready.map((d) => `#${d.issue.number}`).join(", ")}. Move them to Ready in Linear when you want them shipped (or re-run with --keep-ready).`,
    );
  console.log("\nGitHub → Linear:");
  for (const [n, id] of map) console.log(`  #${n} → ${id}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
