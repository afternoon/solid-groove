#!/usr/bin/env node
/**
 * File one QA sweep run's findings (#859). The only part of the sweep that
 * writes to GitHub: the agents themselves run with a read-only token.
 *
 *   node scripts/qa-sweep/file.mjs [--dry-run]
 *
 * Reads each agent's artifact from $QA_SWEEP_ARTIFACTS (default
 * `tmp/qa-sweep/artifacts`), one directory per agent named `qa-sweep-<flow>`
 * holding `findings.json`, `build.json`, `cleanup.json` and the screenshots
 * the findings name. Then, in this order:
 *
 *   1. plans the filing (`planFiling`): new issues up to $QA_SWEEP_ISSUES,
 *      re-seen open issues, and what fell over the cap;
 *   2. finds or creates the pinned "QA sweep" issue;
 *   3. publishes the screenshots with `scripts/walkthrough/publish.mjs`;
 *   4. opens each new `Bug: …` issue and comments on each re-seen one;
 *   5. posts the run summary on the pinned issue.
 *
 * `--dry-run` (or QA_SWEEP_DRY_RUN=true) writes nothing to GitHub and prints
 * what it would have written.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { SITE_ORIGIN } from "../../site.config.mjs";
import {
  describeError,
  fileFindings,
  LOG_LABEL,
  LOG_TITLE,
  logIssueBody,
  planFiling,
  readReport,
  resolveScreenshot,
  screenshotUrl,
  summaryBody,
} from "./sweep.mjs";

const env = process.env;
const DRY_RUN = process.argv.includes("--dry-run") || env.QA_SWEEP_DRY_RUN === "true";
const REPO = env.GITHUB_REPOSITORY ?? "afternoon/solid-groove";
const ARTIFACTS = env.QA_SWEEP_ARTIFACTS ?? "tmp/qa-sweep/artifacts";
const PUBLISH_DIR = "tmp/qa-sweep/publish";
const RUN_URL = env.GITHUB_RUN_ID
  ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${REPO}/actions/runs/${env.GITHUB_RUN_ID}`
  : "local run";
const RUN_ID = env.GITHUB_RUN_NUMBER ?? "local";

const gh = (args, input) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  }).trim();
const ghJson = (args, input) => JSON.parse(gh(args, input));
const post = (path, body) =>
  ghJson(["api", "--method", "POST", path, "--input", "-"], JSON.stringify(body));

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** Every agent's report, cleanup result and build, keyed by the flow it walked. */
function collect(flows) {
  const reports = [];
  const cleanup = [];
  let build = "";
  for (const flow of flows) {
    const dir = join(ARTIFACTS, `qa-sweep-${flow.id}`);
    if (!existsSync(dir)) continue;
    const findings = join(dir, "findings.json");
    if (existsSync(findings)) {
      const report = readReport(readFileSync(findings, "utf8"), flow.id);
      for (const finding of report.findings) finding.dir = dir;
      reports.push(report);
    } else
      reports.push({ flow: flow.id, ok: false, error: "no findings.json", findings: [] });
    const clean = readJson(join(dir, "cleanup.json"));
    if (clean) cleanup.push({ flow: flow.id, ...clean });
    build ||= readJson(join(dir, "build.json"))?.sha ?? "";
  }
  return { reports, cleanup, build };
}

function openIssues() {
  return ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${REPO}/issues?state=open&per_page=100`,
  ])
    .flat()
    .filter((i) => !i.pull_request && !i.labels.some((l) => l.name === LOG_LABEL))
    .map((i) => ({ number: i.number, title: i.title }));
}

/** The pinned issue the summaries go on: the open one labelled `qa-sweep`, or a new one. */
function logIssue() {
  const labels = ghJson([
    "api",
    `repos/${REPO}/labels?per_page=100`,
    "--paginate",
    "--slurp",
  ])
    .flat()
    .map((l) => l.name);
  if (!labels.includes(LOG_LABEL))
    post(`repos/${REPO}/labels`, {
      name: LOG_LABEL,
      color: "000000",
      description: "The pinned QA sweep log",
    });
  const existing = ghJson([
    "api",
    `repos/${REPO}/issues?state=open&labels=${LOG_LABEL}&per_page=10`,
  ]).filter((i) => !i.pull_request);
  if (existing.length > 0) return existing[0].number;
  const created = post(`repos/${REPO}/issues`, {
    title: LOG_TITLE,
    body: logIssueBody(),
    labels: [LOG_LABEL],
  });
  try {
    gh([
      "api",
      "graphql",
      "-f",
      "query=mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{number}}}",
      "-f",
      `id=${created.node_id}`,
    ]);
  } catch {
    console.warn(`Could not pin #${created.number}; pin it by hand.`);
  }
  return created.number;
}

/**
 * Copy each screenshot into its own short directory and publish them all in
 * one push. A finding whose image is missing, or a publish that fails, still
 * gets filed, just without its picture: losing the bug would be worse.
 */
function publishScreenshots(findings, issue) {
  rmSync(PUBLISH_DIR, { recursive: true, force: true });
  const staged = [];
  findings.forEach((finding, n) => {
    if (!finding.screenshot) return;
    // Not a symlink, inside the agent's directory, and really a PNG: this is
    // copied to a public branch.
    const source = resolveScreenshot(finding.dir, finding.screenshot);
    if (!source) return;
    const id = `${RUN_ID}-${n + 1}`;
    mkdirSync(join(PUBLISH_DIR, id), { recursive: true });
    copyFileSync(source, join(PUBLISH_DIR, id, "1.png"));
    writeFileSync(
      join(PUBLISH_DIR, id, "index.json"),
      JSON.stringify({
        id,
        title: finding.title,
        steps: [{ file: "1.png", caption: finding.title }],
      }),
    );
    staged.push({ finding, id });
  });
  if (staged.length === 0 || DRY_RUN) return;
  try {
    execFileSync("node", ["scripts/walkthrough/publish.mjs", "--issue", String(issue)], {
      env: { ...env, WALKTHROUGH_DIR: PUBLISH_DIR },
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    console.warn("Publishing the screenshots failed; filing without them.");
    return;
  }
  for (const { finding, id } of staged)
    finding.screenshotUrl = screenshotUrl({ repo: REPO, issue, id });
}

function main() {
  const flows = JSON.parse(env.QA_SWEEP_FLOWS_JSON ?? "[]");
  const limits = {
    agents: Number(env.QA_SWEEP_AGENTS ?? flows.length),
    issues: Number(env.QA_SWEEP_ISSUES ?? 15),
  };
  const { reports, cleanup, build } = collect(flows);
  const findings = reports.flatMap((r) => r.findings);
  const failures = [];

  // Without the open issues there is no telling a new bug from a known one,
  // so nothing is filed; the summary still goes out and lists them as not filed.
  let open = [];
  let canFile = true;
  if (!(DRY_RUN && !env.GH_TOKEN)) {
    try {
      open = openIssues();
    } catch (error) {
      failures.push({ what: "listing open issues", error: describeError(error) });
      canFile = false;
    }
  }
  const plan = planFiling({ findings, openIssues: open, maxIssues: limits.issues });
  if (!canFile) for (const finding of plan.file) finding.failed = true;
  const ctx = { runUrl: RUN_URL, build, siteUrl: SITE_ORIGIN, flows };

  let log = 0;
  if (!DRY_RUN) {
    try {
      log = logIssue();
    } catch (error) {
      failures.push({ what: "finding the QA sweep issue", error: describeError(error) });
    }
  }
  if (canFile) {
    // Screenshots are published under the log issue's number; without it the
    // findings are still filed, just with no picture.
    if (DRY_RUN || log)
      publishScreenshots([...plan.file, ...plan.reseen.flatMap((r) => r.findings)], log);
    failures.push(...fileFindings({ plan, ctx, repo: REPO, post, dryRun: DRY_RUN }));
  }

  const summary = () =>
    summaryBody({
      date: new Date().toISOString().slice(0, 10),
      runUrl: RUN_URL,
      build,
      limits,
      flows,
      reports,
      filed: plan.file,
      reseen: plan.reseen,
      overCap: plan.overCap,
      cleanup,
      failures,
      dryRun: DRY_RUN,
    });
  if (DRY_RUN) console.log(`\n=== would post on the QA sweep issue\n${summary()}`);
  else if (log) {
    try {
      post(`repos/${REPO}/issues/${log}/comments`, { body: summary() });
      console.log(`Posted the run summary on #${log}.`);
    } catch (error) {
      failures.push({
        what: `posting the summary on #${log}`,
        error: describeError(error),
      });
    }
  }
  // The job summary always gets it, with every failed write listed.
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary()}\n`);

  for (const f of failures) console.error(`GitHub write failed, ${f.what}: ${f.error}`);
  // The summary says which; the red run is so somebody looks.
  const unclean = flows.filter((f) => !cleanup.find((c) => c.flow === f.id)?.ok);
  if (unclean.length > 0)
    console.error(
      `Projects may be left behind by: ${unclean.map((f) => f.id).join(", ")}.`,
    );
  if (unclean.length > 0 || failures.length > 0) process.exitCode = 1;
}

main();
