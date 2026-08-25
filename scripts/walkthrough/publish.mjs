#!/usr/bin/env node
/**
 * Publish a captured core-flow walkthrough and print the Markdown for a pull
 * request body.
 *
 * Why this exists at all: GitHub's media-upload endpoint — the one behind
 * drag-and-drop in the web UI — is not part of the REST API, and `gh` has no
 * command for it. An agent therefore *cannot* attach an image to a PR body the
 * way a person does. What does work is a Markdown image pointing at a URL
 * GitHub can fetch, so this script pushes the captured PNGs to a dedicated
 * orphan branch and emits `![...](https://raw.githubusercontent.com/...)`
 * links against it.
 *
 * An orphan branch, not the feature branch, because walkthrough images are
 * review artefacts and have no business in `main`'s history or in a diff that
 * is capped at 400 lines. It is named `claude/walkthroughs` so it sits inside
 * the `claude/`-prefixed namespace that cloud sessions are always allowed to
 * push to.
 *
 * This depends on `afternoon/solid-groove` being a **public** repository.
 * GitHub renders a Markdown image by proxying the URL anonymously, and
 * `raw.githubusercontent.com` refuses anonymous reads of a private repo — so if
 * this repository is ever made private, every published walkthrough silently
 * becomes a broken-image icon in the PR body. There is no fix from here: the
 * only host whose images render for a private repo is GitHub's own attachment
 * store, and nothing but the web UI can upload to it. Raise it rather than
 * working around it.
 *
 * Usage:
 *   bun run walkthrough:publish -- --issue 123
 *   bun run walkthrough:publish -- --issue 123 --dry-run
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRANCH = "claude/walkthroughs";
const SOURCE_ROOT = process.env.WALKTHROUGH_DIR ?? "walkthroughs";
const PUSH_ATTEMPTS = 3;

const git = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();

const fail = (message) => {
  console.error(`walkthrough:publish — ${message}`);
  process.exit(1);
};

function parseArgs(argv) {
  const args = { issue: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--issue") args.issue = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!args.issue || !/^\d+$/.test(args.issue))
    fail("--issue <number> is required; it is the directory the images are filed under.");
  return args;
}

/** `owner/repo`, from whatever form the origin remote takes (https or ssh). */
function repoSlug() {
  const url = git(["remote", "get-url", "origin"]);
  const match = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) fail(`could not parse an owner/repo out of the origin remote: ${url}`);
  return `${match[1]}/${match[2]}`;
}

/** Every flow directory that carries an `index.json` written by the capture helper. */
function collectFlows() {
  if (!existsSync(SOURCE_ROOT))
    fail(`no ${SOURCE_ROOT}/ directory — run \`bun run walkthrough:capture\` first.`);

  const flows = readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(SOURCE_ROOT, entry.name))
    .filter((directory) => existsSync(join(directory, "index.json")))
    .map((directory) => ({
      directory,
      ...JSON.parse(readFileSync(join(directory, "index.json"), "utf8")),
    }));

  if (flows.length === 0)
    fail(
      `no captured flows under ${SOURCE_ROOT}/. The capture run produced nothing — check that the spec calls \`walkthrough()\` and that CAPTURE_WALKTHROUGH=1 was set.`,
    );

  for (const flow of flows)
    if (!Array.isArray(flow.steps) || flow.steps.length === 0)
      fail(`${flow.id ?? flow.directory} captured no steps.`);

  return flows.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Check the orphan branch out into a throwaway worktree. The main working tree
 * is left completely alone — this runs while the agent still has the feature
 * branch checked out with uncommitted work.
 */
function checkoutBranch() {
  const path = mkdtempSync(join(tmpdir(), "walkthroughs-"));
  rmSync(path, { recursive: true, force: true });

  const remoteExists = (() => {
    try {
      return git(["ls-remote", "--exit-code", "origin", BRANCH]).length > 0;
    } catch {
      return false;
    }
  })();

  if (remoteExists) {
    git(["fetch", "origin", BRANCH]);
    git(["worktree", "add", "-B", BRANCH, path, `origin/${BRANCH}`]);
  } else {
    git(["worktree", "add", "--detach", path, "HEAD"]);
    git(["checkout", "--orphan", BRANCH], { cwd: path });
    // The orphan checkout keeps HEAD's tree staged; the branch must start empty.
    git(["rm", "-rf", "--quiet", "."], { cwd: path });
  }
  return { path, remoteExists };
}

function publish({ issue, dryRun }, flows) {
  const worktree = checkoutBranch();
  try {
    for (const flow of flows) {
      const destination = join(worktree.path, issue, flow.id);
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(destination, { recursive: true });
      cpSync(flow.directory, destination, { recursive: true });
    }

    git(["add", "--all", issue], { cwd: worktree.path });
    const staged = git(["status", "--porcelain"], { cwd: worktree.path });
    if (!staged) {
      console.error(
        `walkthrough:publish — images are byte-identical to the published set; nothing to push.`,
      );
      return;
    }

    if (dryRun) {
      console.error(
        `walkthrough:publish — dry run, not committing. Would publish:\n${staged}`,
      );
      return;
    }

    git(["commit", "--message", `Walkthrough screenshots for #${issue}`], {
      cwd: worktree.path,
    });

    for (let attempt = 1; ; attempt++) {
      try {
        git(["push", "-u", "origin", BRANCH], { cwd: worktree.path });
        break;
      } catch (error) {
        // A sibling agent published between our fetch and our push. The two
        // commits touch different issue directories, so replaying ours on
        // top is always the right resolution.
        if (attempt >= PUSH_ATTEMPTS) throw error;
        console.error(
          `walkthrough:publish — push rejected (attempt ${attempt}); rebasing on the remote and retrying.`,
        );
        git(["fetch", "origin", BRANCH], { cwd: worktree.path });
        git(["rebase", `origin/${BRANCH}`], { cwd: worktree.path });
      }
    }
  } finally {
    git(["worktree", "remove", "--force", worktree.path]);
  }
}

function markdown({ issue }, flows, slug) {
  const lines = ["## Walkthrough", ""];
  for (const flow of flows) {
    lines.push(`### ${flow.id} — ${flow.title}`, "");
    for (const [index, step] of flow.steps.entries()) {
      const url = `https://raw.githubusercontent.com/${slug}/refs/heads/${BRANCH}/${issue}/${flow.id}/${step.file}`;
      lines.push(
        `**${index + 1}. ${step.caption}**`,
        "",
        `![${flow.id} step ${index + 1}](${url})`,
        "",
      );
    }
  }
  lines.push(
    `<sub>Captured by \`bun run walkthrough:capture\` from the core-flow specs, in Chromium. Flows are defined in [\`docs/core-flows.md\`](https://github.com/${slug}/blob/main/docs/core-flows.md).</sub>`,
    "",
  );
  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
const flows = collectFlows();
const slug = repoSlug();

publish(args, flows);

const body = markdown(args, flows, slug);
const outputPath = join(SOURCE_ROOT, "WALKTHROUGH.md");
writeFileSync(outputPath, body);
process.stdout.write(body);

const screenshots = flows.reduce((total, flow) => total + flow.steps.length, 0);
console.error(
  args.dryRun
    ? `\nwalkthrough:publish — dry run: ${flows.length} flow(s), ${screenshots} screenshot(s) NOT pushed. The image links above are dead until you re-run without --dry-run.`
    : `\nwalkthrough:publish — ${flows.length} flow(s), ${screenshots} screenshot(s) pushed to \`${BRANCH}\`. Markdown also written to ${outputPath}; paste it into the PR body's Walkthrough section.`,
);
