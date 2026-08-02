#!/usr/bin/env node
/**
 * Mirror the `Dependencies:` graph in docs/backlog.md onto GitHub issue
 * dependencies ("blocked by" relationships).
 *
 * The backlog stays the source of truth for the work graph; this script pushes
 * it to GitHub so the graph does not have to be rebuilt by hand every time
 * something lands. It is idempotent: it reads the existing `blocked_by` set on
 * each issue and adds only the edges that are missing. It never removes an edge
 * it did not plan, unless you pass --prune.
 *
 * Usage:
 *   bun run issues:deps                  # dry run, prints every edge it would add
 *   bun run issues:deps -- --apply       # write them
 *   bun run issues:deps -- --apply --prune
 *
 * Authentication is the GitHub CLI's: run `gh auth login` once. No token is
 * read from the environment, so there is nothing to leak into a shell history.
 *
 * This targets GitHub's issue-dependencies REST endpoints
 * (`/issues/{n}/dependencies/blocked_by`, which take the dependency's numeric
 * `issue_id` rather than its number). That API is newer than the rest of what
 * this repo calls and has not been exercised from CI here, so run the dry run
 * first: a shape mismatch surfaces as a failed request with the response body
 * printed, not as a silent no-op.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const OWNER = "afternoon";
const REPO = "solid-groove";

/**
 * Pull every `### TASK-ID - Title` block out of the backlog and read its
 * `Dependencies:` field. Returns a Map of task id -> array of task ids.
 *
 * Exported for the test; keep it pure so the graph can be checked without a
 * network call or a token.
 */
export function parseBacklogGraph(markdown) {
	const graph = new Map();

	// Split on the heading rather than matching whole blocks with one regex:
	// JavaScript has no \Z, and anchoring the end of a block with $ under the
	// `m` flag terminates it at the first line break instead of the next
	// heading.
	for (const section of markdown.split(/^### /m).slice(1)) {
		const newline = section.indexOf("\n");
		const heading = newline === -1 ? section : section.slice(0, newline);
		const body = newline === -1 ? "" : section.slice(newline + 1);

		const taskId = heading.match(/^([A-Z]+-\d+[a-z]?)\s+-\s+/)?.[1];
		if (!taskId) continue;

		const field = body.match(/Dependencies: ([^`<\n]*)/);
		const raw = field?.[1]?.trim() ?? "";
		const deps =
			raw === "" || raw.toLowerCase() === "none"
				? []
				: raw
						.split(",")
						.map((d) => d.trim())
						.filter(Boolean);
		graph.set(taskId, deps);
	}
	return graph;
}

/** Map `TASK-ID - Title` issue titles back to their task id. */
export function indexIssuesByTask(issues) {
	const byTask = new Map();
	for (const issue of issues) {
		const match = issue.title.match(/^([A-Z]+-\d+[a-z]?)\s+-\s+/);
		if (match) byTask.set(match[1], issue);
	}
	return byTask;
}

/**
 * Turn the backlog graph plus the issue index into the concrete edge list.
 *
 * A dependency with no issue is reported rather than skipped silently: the
 * Alpha Milestone 0 tasks landed before the one-issue-per-task convention and
 * have no issue to point at, and a typo in the backlog would look identical.
 */
export function planEdges(graph, byTask) {
	const edges = [];
	const missing = [];

	for (const [taskId, deps] of graph) {
		const issue = byTask.get(taskId);
		if (!issue) {
			if (deps.length > 0)
				missing.push({ taskId, reason: "task has no issue" });
			continue;
		}
		for (const dep of deps) {
			const depIssue = byTask.get(dep);
			if (!depIssue) {
				missing.push({ taskId, dep, reason: "dependency has no issue" });
				continue;
			}
			edges.push({
				taskId,
				dep,
				issueNumber: issue.number,
				blockedByNumber: depIssue.number,
				blockedById: depIssue.id,
			});
		}
	}
	return { edges, missing };
}

/**
 * One GitHub call through `gh api`, so authentication is whatever `gh auth
 * login` already established rather than a token this script has to be handed.
 */
function gh(path, { method = "GET", body } = {}) {
	const args = [
		"api",
		"--method",
		method,
		path,
		"-H",
		"Accept: application/vnd.github+json",
		"-H",
		"X-GitHub-Api-Version: 2022-11-28",
	];
	if (body) args.push("--input", "-");

	let stdout;
	try {
		stdout = execFileSync("gh", args, {
			input: body ? JSON.stringify(body) : undefined,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (error) {
		// gh puts the API's own error body on stderr; it is the useful part.
		const detail = error.stderr?.trim() || error.message;
		throw new Error(`${method} ${path}\n${detail}`);
	}
	return stdout.trim() === "" ? null : JSON.parse(stdout);
}

function requireGh() {
	try {
		execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
	} catch (error) {
		const detail = error.stderr?.toString().trim() ?? "";
		throw new Error(
			`\`gh\` is unavailable or not authenticated.\n${detail}\n\n` +
				"Install it from https://cli.github.com, then run `gh auth login`.",
		);
	}
}

function fetchAllIssues() {
	const issues = [];
	for (let page = 1; ; page += 1) {
		const batch = gh(
			`/repos/${OWNER}/${REPO}/issues?state=all&per_page=100&page=${page}`,
		);
		// The issues endpoint returns pull requests too; they are not tasks.
		issues.push(...batch.filter((i) => !i.pull_request));
		if (batch.length < 100) break;
	}
	return issues;
}

function main() {
	const { values } = parseArgs({
		options: {
			apply: { type: "boolean", default: false },
			prune: { type: "boolean", default: false },
		},
	});

	requireGh();

	const graph = parseBacklogGraph(readFileSync("docs/backlog.md", "utf8"));
	const issues = fetchAllIssues();
	const byTask = indexIssuesByTask(issues);
	const { edges, missing } = planEdges(graph, byTask);

	console.log(
		`${graph.size} task blocks in the backlog, ${byTask.size} matched to issues.`,
	);
	console.log(`${edges.length} dependency edges planned.\n`);

	for (const m of missing) {
		const what = m.dep ? `${m.taskId} -> ${m.dep}` : m.taskId;
		console.log(`  skipped  ${what.padEnd(24)} ${m.reason}`);
	}
	if (missing.length > 0) console.log("");

	// Group by the blocked issue so each one is read once, not once per edge.
	const byIssue = new Map();
	for (const edge of edges) {
		if (!byIssue.has(edge.issueNumber)) byIssue.set(edge.issueNumber, []);
		byIssue.get(edge.issueNumber).push(edge);
	}

	// Pruning has to visit issues with no wanted edges too, or a task whose
	// dependencies were all removed from the backlog would keep its stale ones.
	if (values.prune) {
		for (const issue of byTask.values()) {
			if (!byIssue.has(issue.number)) byIssue.set(issue.number, []);
		}
	}

	let added = 0;
	let present = 0;
	let removed = 0;

	for (const [issueNumber, wanted] of byIssue) {
		const path = `/repos/${OWNER}/${REPO}/issues/${issueNumber}/dependencies/blocked_by`;
		const existing = gh(path);
		const existingIds = new Set(existing.map((i) => i.id));
		const wantedIds = new Set(wanted.map((e) => e.blockedById));

		for (const edge of wanted) {
			if (existingIds.has(edge.blockedById)) {
				present += 1;
				continue;
			}
			const label = `#${issueNumber} ${edge.taskId} blocked by #${edge.blockedByNumber} ${edge.dep}`;
			if (!values.apply) {
				console.log(`  would add   ${label}`);
			} else {
				gh(path, { method: "POST", body: { issue_id: edge.blockedById } });
				console.log(`  added       ${label}`);
			}
			added += 1;
		}

		if (values.prune) {
			for (const stale of existing.filter((i) => !wantedIds.has(i.id))) {
				const label = `#${issueNumber} no longer blocked by #${stale.number}`;
				if (!values.apply) {
					console.log(`  would prune ${label}`);
				} else {
					gh(`${path}/${stale.id}`, { method: "DELETE" });
					console.log(`  pruned      ${label}`);
				}
				removed += 1;
			}
		}
	}

	const verb = values.apply ? "applied" : "planned (dry run)";
	console.log(
		`\n${verb}: ${added} added, ${present} already present` +
			(values.prune ? `, ${removed} pruned` : ""),
	);
	if (!values.apply && added + removed > 0) {
		console.log("Re-run with --apply to write these to GitHub.");
	}
}

// Only run when invoked directly, so the test can import the pure helpers.
if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(`\n${error.message}`);
		process.exit(1);
	}
}
