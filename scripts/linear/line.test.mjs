import { describe, expect, it } from "vitest";
import { failedGates, fixesMain, GATE_JOBS } from "../../.github/scripts/merge.mjs";

const pr = (headRefName, labels = []) => ({
  headRefName,
  labels: labels.map((name) => ({ name })),
});

describe("fixesMain", () => {
  it("lets the revert and a labelled fix land while the line is stopped", () => {
    expect(fixesMain(pr("revert/pr-1177"))).toBe(true);
    expect(fixesMain(pr("claude/flaky-test", ["fixes-main"]))).toBe(true);
  });

  it("holds every other PR", () => {
    expect(fixesMain(pr("claude/grv-26-client", ["status:approved"]))).toBe(false);
  });
});

describe("failedGates", () => {
  it("counts only failed gate jobs", () => {
    const jobs = [
      { name: GATE_JOBS[0], conclusion: "failure" },
      { name: GATE_JOBS[1], conclusion: "success" },
      { name: "deploy to Firebase Hosting", conclusion: "failure" },
    ];
    expect(failedGates(jobs)).toEqual([GATE_JOBS[0]]);
  });

  it("finds nothing when only a deploy failed", () => {
    expect(
      failedGates([{ name: "deploy to Firebase Hosting", conclusion: "failure" }]),
    ).toEqual([]);
  });
});
