import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	emitShellScript,
	indexIssuesByTask,
	parseBacklogGraph,
	parseIssueIndex,
	planEdges,
} from "./sync-issue-dependencies.mjs";

const BACKLOG = `
### FND-001 - Test and development foundation

\`Dependencies: none\`<br>
\`PRD: 9.1, 10, 14\`

Prose that mentions Dependencies: nowhere useful.

### LOOP-003 - Transport, tempo, loop, and metronome

\`Status: todo | Owner: unassigned | Dependencies: FND-009\`<br>
\`PRD: AUD-01 | Evidence: pending\`

### LOOP-004 - Synth and one-shot sampler

\`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001\`<br>
\`PRD: INS-01 | Evidence: pending\`
`;

describe("parseBacklogGraph", () => {
	it("reads dependencies from both the bare and the status-prefixed form", () => {
		const graph = parseBacklogGraph(BACKLOG);

		expect(graph.get("FND-001")).toEqual([]);
		expect(graph.get("LOOP-003")).toEqual(["FND-009"]);
		expect(graph.get("LOOP-004")).toEqual(["LOOP-003", "CNT-001"]);
	});

	it("treats the real backlog as a connected graph with no unknown task ids", () => {
		const graph = parseBacklogGraph(readFileSync("docs/backlog.md", "utf8"));

		expect(graph.size).toBeGreaterThan(50);
		for (const [taskId, deps] of graph) {
			for (const dep of deps) {
				expect(graph.has(dep), `${taskId} depends on unknown ${dep}`).toBe(
					true,
				);
			}
		}
	});

	it("finds no dependency cycle in the real backlog", () => {
		const graph = parseBacklogGraph(readFileSync("docs/backlog.md", "utf8"));
		const state = new Map();

		const visit = (task, trail) => {
			if (state.get(task) === "done") return;
			if (state.get(task) === "open") {
				throw new Error(`cycle: ${[...trail, task].join(" -> ")}`);
			}
			state.set(task, "open");
			for (const dep of graph.get(task) ?? []) visit(dep, [...trail, task]);
			state.set(task, "done");
		};

		expect(() => {
			for (const task of graph.keys()) visit(task, []);
		}).not.toThrow();
	});
});

describe("planEdges", () => {
	const issues = [
		{ number: 43, id: 1043, title: "LOOP-003 - Transport, tempo, loop" },
		{ number: 44, id: 1044, title: "LOOP-004 - Synth and one-shot sampler" },
		{ number: 53, id: 1053, title: "CNT-001 - Asset manifest and ingestion" },
	];

	it("maps each dependency to the issue id the API needs", () => {
		const graph = parseBacklogGraph(BACKLOG);
		const { edges } = planEdges(graph, indexIssuesByTask(issues));

		expect(edges).toContainEqual({
			taskId: "LOOP-004",
			dep: "LOOP-003",
			issueNumber: 44,
			blockedByNumber: 43,
			blockedById: 1043,
		});
	});

	it("reports a dependency with no issue instead of dropping it silently", () => {
		const graph = parseBacklogGraph(BACKLOG);
		const { edges, missing } = planEdges(graph, indexIssuesByTask(issues));

		// FND-009 has no issue in this fixture, so LOOP-003's edge cannot be made.
		expect(edges.some((e) => e.dep === "FND-009")).toBe(false);
		expect(missing).toContainEqual({
			taskId: "LOOP-003",
			dep: "FND-009",
			reason: "dependency has no issue",
		});
	});

	it("ignores a task with no dependencies", () => {
		const graph = parseBacklogGraph(BACKLOG);
		const { edges, missing } = planEdges(graph, indexIssuesByTask(issues));

		expect(edges.some((e) => e.taskId === "FND-001")).toBe(false);
		expect(missing.some((m) => m.taskId === "FND-001")).toBe(false);
	});
});

describe("parseIssueIndex", () => {
	it("reads the task -> issue number map out of the backlog index table", () => {
		const index = parseIssueIndex(readFileSync("docs/backlog.md", "utf8"));

		expect(index.get("LOOP-003")).toBe(43);
		expect(index.get("REL-003")).toBe(80);
		expect(index.size).toBeGreaterThan(50);
	});
});

describe("the checked-in shell script", () => {
	const backlog = readFileSync("docs/backlog.md", "utf8");
	const generated = emitShellScript(
		parseBacklogGraph(backlog),
		parseIssueIndex(backlog),
		{ skipped: [] },
	);
	const committed = readFileSync(
		"scripts/create-issue-dependencies.sh",
		"utf8",
	);

	const edgeLines = (text) =>
		text.split("\n").filter((line) => line.startsWith("edge "));

	it("declares exactly the edges the current backlog implies", () => {
		expect(edgeLines(committed)).toEqual(edgeLines(generated));
	});

	it("emits a real edge with the blocked issue first", () => {
		// LOOP-004 (#44) depends on LOOP-003 (#43): #44 is blocked by #43.
		expect(edgeLines(committed)).toContain("edge 44 43 'LOOP-004 <- LOOP-003'");
	});

	it("passes issue_id as a number, since the API rejects a string", () => {
		expect(committed).toContain('-F "issue_id=${blocker_id}"');
		expect(committed).not.toContain('-f "issue_id=');
	});
});
