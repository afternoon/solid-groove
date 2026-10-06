import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFlows, plan } from "./plan.mjs";
import {
  capBody,
  fileFindings,
  isSafeScreenshotPath,
  issueBody,
  MAX_BODY,
  neutralizeMentions,
  normalizeTitle,
  parseFlowList,
  parseFlows,
  pickFlows,
  planFiling,
  readReport,
  reseenComment,
  resolveLimit,
  resolveScreenshot,
  screenshotUrl,
  summaryBody,
  validateFinding,
} from "./sweep.mjs";

const flowsOf = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `CF-${String(i + 1).padStart(3, "0")}`,
    title: `Flow ${i + 1}`,
    parked: false,
  }));

const finding = (overrides = {}) => ({
  title: "Bug: Tempo field accepts letters",
  symptom: "Typing abc into the tempo field shows NaN.",
  expected: "The field rejects letters and keeps the old tempo.",
  steps: ["Open a project.", "Type abc into the tempo field."],
  severity: "medium",
  screenshot: null,
  duplicateOf: null,
  flow: "CF-001",
  ...overrides,
});

describe("resolveLimit", () => {
  const opts = { fallback: 5, ceiling: 10, min: 1, name: "agents" };

  it("takes the first source that sets a value, skipping blanks", () => {
    expect(resolveLimit(["", "3"], opts)).toBe(3);
    expect(resolveLimit(["2", "3"], opts)).toBe(2);
    expect(resolveLimit([undefined, "  "], opts)).toBe(5);
  });

  it("clamps to the ceiling so a typo cannot flood the tracker", () => {
    expect(resolveLimit(["500"], opts)).toBe(10);
  });

  it("rejects anything that is not a whole number at least the minimum", () => {
    expect(() => resolveLimit(["0"], opts)).toThrow(/at least 1/);
    expect(() => resolveLimit(["2.5"], opts)).toThrow();
    expect(() => resolveLimit(["five"], opts)).toThrow();
    expect(() => resolveLimit(["-1"], { ...opts, min: 0 })).toThrow();
  });

  it("allows zero issues, which walks the flows and files nothing", () => {
    expect(resolveLimit(["0"], { fallback: 15, ceiling: 50 })).toBe(0);
  });
});

describe("parseFlows", () => {
  const register = [
    "### CF-0NN — Template, not a flow",
    "### CF-001 — A visitor reaches a playing loop",
    "### CF-002 — A producer outlines a song",
  ].join("\n\n");

  it("reads every registered flow and skips the template", () => {
    expect(parseFlows(register).map((f) => f.id)).toEqual(["CF-001", "CF-002"]);
  });

  it("marks a flow parked only when its spec calls test.fixme outside a comment", () => {
    const specs = new Map([
      ["CF-001", "// test.fixme(...) was here once\ntest('x', () => {});"],
      ["CF-002", "test.fixme('not built yet', () => {});"],
    ]);
    expect(parseFlows(register, specs).map((f) => f.parked)).toEqual([false, true]);
  });
});

describe("pickFlows", () => {
  const flows = flowsOf(12);
  const day = (iso) => new Date(`${iso}T06:00:00Z`);

  it("takes the requested flows, capped at the agent count", () => {
    const picked = pickFlows({
      flows,
      count: 2,
      date: day("2026-10-05"),
      requested: ["CF-007", "CF-003", "CF-009"],
    });
    expect(picked.map((f) => f.id)).toEqual(["CF-007", "CF-003"]);
  });

  it("refuses a requested flow that is not registered", () => {
    expect(() =>
      pickFlows({ flows, count: 5, date: new Date(), requested: ["CF-099"] }),
    ).toThrow(/CF-099/);
  });

  it("rotates through the register week by week, covering every flow", () => {
    const seen = new Set();
    let date = day("2026-10-05");
    for (let week = 0; week < 3; week++) {
      const picked = pickFlows({ flows, count: 4, date });
      expect(picked).toHaveLength(4);
      for (const f of picked) seen.add(f.id);
      date = new Date(date.getTime() + 7 * 86_400_000);
    }
    expect(seen.size).toBe(12);
  });

  it("is the same pick for the same week", () => {
    const a = pickFlows({ flows, count: 5, date: day("2026-10-05") });
    const b = pickFlows({ flows, count: 5, date: day("2026-10-06") });
    expect(a).toEqual(b);
  });

  it("walks each flow once when there are more agents than flows", () => {
    const picked = pickFlows({ flows: flowsOf(3), count: 5, date: new Date() });
    expect(picked.map((f) => f.id).sort()).toEqual(["CF-001", "CF-002", "CF-003"]);
  });
});

describe("parseFlowList", () => {
  it("accepts IDs separated by commas or spaces, in any case or padding", () => {
    expect(parseFlowList("CF-001, cf-7 cf012")).toEqual(["CF-001", "CF-007", "CF-012"]);
    expect(parseFlowList("")).toEqual([]);
  });

  it("rejects anything else", () => {
    expect(() => parseFlowList("mixer")).toThrow(/mixer/);
  });
});

describe("plan", () => {
  let root;
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));

  it("reads the register and spec files from disk", () => {
    root = mkdtempSync(join(tmpdir(), "qa-sweep-plan-"));
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "tests/e2e/emulator/flows"), { recursive: true });
    writeFileSync(
      join(root, "docs/core-flows.md"),
      "### CF-001 — One\n\n### CF-002 — Two\n\n### CF-003 — Three\n",
    );
    writeFileSync(
      join(root, "tests/e2e/emulator/flows/CF-002.spec.ts"),
      "test.fixme('later', () => {});",
    );
    expect(loadFlows(root).find((f) => f.id === "CF-002").parked).toBe(true);

    const result = plan(
      { QA_SWEEP_AGENTS_VAR: "2", QA_SWEEP_ISSUES_INPUT: "4", QA_SWEEP_FLOWS: "cf-3" },
      { root },
    );
    expect(result).toEqual({
      agents: 2,
      issues: 4,
      flows: [{ id: "CF-003", title: "Three", parked: false, slot: 1 }],
    });
  });

  it("defaults to five agents and fifteen issues", () => {
    root = mkdtempSync(join(tmpdir(), "qa-sweep-plan-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, "docs/core-flows.md"),
      flowsOf(8)
        .map((f) => `### ${f.id} — ${f.title}`)
        .join("\n\n"),
    );
    const result = plan({}, { root, date: new Date("2026-10-05T00:00:00Z") });
    expect(result.agents).toBe(5);
    expect(result.issues).toBe(15);
    expect(result.flows).toHaveLength(5);
  });

  it("gives each agent its own QA account slot, 1 up to the agent ceiling", () => {
    root = mkdtempSync(join(tmpdir(), "qa-sweep-plan-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, "docs/core-flows.md"),
      flowsOf(30)
        .map((f) => `### ${f.id} — ${f.title}`)
        .join("\n\n"),
    );
    const result = plan({ QA_SWEEP_AGENTS_INPUT: "99" }, { root });
    expect(result.flows.map((f) => f.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("validateFinding", () => {
  const { flow: _flow, ...valid } = finding();

  it("accepts a complete finding and defaults its severity", () => {
    const { severity: _severity, ...noSeverity } = valid;
    expect(validateFinding(noSeverity).finding).toMatchObject({ severity: "medium" });
  });

  it("requires the title to start with Bug:", () => {
    expect(validateFinding({ ...valid, title: "Tempo broken" }).problems).toContain(
      'title does not start with "Bug: "',
    );
  });

  it("requires symptom, expected and at least one step", () => {
    const { problems } = validateFinding({
      ...valid,
      symptom: " ",
      expected: undefined,
      steps: [],
    });
    expect(problems).toEqual([
      "symptom is missing",
      "expected is missing",
      "steps is missing",
    ]);
  });

  it("rejects a screenshot path that could escape the agent's output", () => {
    for (const path of [
      "../session.json",
      "/etc/passwd.png",
      "shots/../../x.png",
      "x.jpg",
    ])
      expect(validateFinding({ ...valid, screenshot: path }).problems).toBeDefined();
    expect(
      validateFinding({ ...valid, screenshot: "shots/tempo.png" }).finding,
    ).toBeDefined();
  });

  it("rejects an unknown severity or a non-numeric duplicate", () => {
    expect(validateFinding({ ...valid, severity: "critical" }).problems).toBeDefined();
    expect(validateFinding({ ...valid, duplicateOf: "#12" }).problems).toBeDefined();
  });

  it("cuts an overlong title", () => {
    const { finding: f } = validateFinding({
      ...valid,
      title: `Bug: ${"x".repeat(300)}`,
    });
    expect(f.title.length).toBe(120);
  });
});

describe("isSafeScreenshotPath", () => {
  it("allows only relative png paths with no parent or empty segments", () => {
    expect(isSafeScreenshotPath("shots/a.png")).toBe(true);
    expect(isSafeScreenshotPath("shots//a.png")).toBe(false);
    expect(isSafeScreenshotPath("shots\\a.png")).toBe(false);
  });
});

describe("readReport", () => {
  it("keeps the valid findings and lists the rejected ones", () => {
    const { flow: _flow, ...valid } = finding();
    const report = readReport(
      JSON.stringify({ findings: [valid, { title: "nope" }], notes: "Walked it all." }),
      "CF-004",
    );
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].flow).toBe("CF-004");
    expect(report.rejected).toHaveLength(1);
    expect(report.notes).toBe("Walked it all.");
  });

  it("treats an unreadable report as a failed agent, not zero findings", () => {
    expect(readReport("{", "CF-001")).toMatchObject({ ok: false });
    expect(readReport("{}", "CF-001")).toMatchObject({ ok: false });
  });
});

describe("normalizeTitle", () => {
  it("ignores the Bug: prefix, case and punctuation", () => {
    expect(normalizeTitle("Bug: Tempo field accepts letters!")).toBe(
      normalizeTitle("tempo field   accepts letters"),
    );
  });
});

describe("planFiling", () => {
  it("files new findings up to the cap and lists the rest as over the cap", () => {
    const findings = [1, 2, 3, 4].map((n) => finding({ title: `Bug: Problem ${n}` }));
    const plan = planFiling({ findings, openIssues: [], maxIssues: 3 });
    expect(plan.file.map((f) => f.title)).toEqual([
      "Bug: Problem 1",
      "Bug: Problem 2",
      "Bug: Problem 3",
    ]);
    expect(plan.overCap.map((f) => f.title)).toEqual(["Bug: Problem 4"]);
  });

  it("enforces the cap across every agent, most severe first", () => {
    const findings = [
      finding({ flow: "CF-001", title: "Bug: A", severity: "low" }),
      finding({ flow: "CF-002", title: "Bug: B", severity: "high" }),
      finding({ flow: "CF-003", title: "Bug: C", severity: "medium" }),
    ];
    const plan = planFiling({ findings, openIssues: [], maxIssues: 2 });
    expect(plan.file.map((f) => f.title)).toEqual(["Bug: B", "Bug: C"]);
    expect(plan.overCap.map((f) => f.title)).toEqual(["Bug: A"]);
  });

  it("files nothing when the cap is zero", () => {
    const plan = planFiling({ findings: [finding()], openIssues: [], maxIssues: 0 });
    expect(plan.file).toEqual([]);
    expect(plan.overCap).toHaveLength(1);
  });

  it("comments on the open issue an agent names as the duplicate", () => {
    const plan = planFiling({
      findings: [finding({ duplicateOf: 42 })],
      openIssues: [{ number: 42, title: "Bug: Tempo input takes text" }],
      maxIssues: 15,
    });
    expect(plan.file).toEqual([]);
    expect(plan.reseen).toMatchObject([{ number: 42 }]);
  });

  it("files anew when the named duplicate is not an open issue", () => {
    const plan = planFiling({
      findings: [finding({ duplicateOf: 7 })],
      openIssues: [],
      maxIssues: 15,
    });
    expect(plan.file).toHaveLength(1);
  });

  it("matches an open issue with the same title, and that does not use up the cap", () => {
    const plan = planFiling({
      findings: [
        finding({ title: "Bug: tempo field accepts letters" }),
        finding({ title: "Bug: Something else" }),
      ],
      openIssues: [{ number: 9, title: "Bug: Tempo field accepts letters" }],
      maxIssues: 1,
    });
    expect(plan.reseen.map((r) => r.number)).toEqual([9]);
    expect(plan.file.map((f) => f.title)).toEqual(["Bug: Something else"]);
    expect(plan.overCap).toEqual([]);
  });

  it("makes one issue when two agents report the same bug", () => {
    const plan = planFiling({
      findings: [finding({ flow: "CF-001" }), finding({ flow: "CF-004" })],
      openIssues: [],
      maxIssues: 15,
    });
    expect(plan.file).toHaveLength(1);
    expect(plan.file[0].alsoSeenIn).toEqual(["CF-004"]);
  });

  it("groups several findings that re-see one issue into one entry", () => {
    const plan = planFiling({
      findings: [
        finding({ duplicateOf: 5 }),
        finding({ flow: "CF-002", title: "Bug: other words", duplicateOf: 5 }),
      ],
      openIssues: [{ number: 5, title: "Bug: x" }],
      maxIssues: 15,
    });
    expect(plan.reseen).toHaveLength(1);
    expect(plan.reseen[0].findings).toHaveLength(2);
  });
});

describe("screenshotUrl", () => {
  it("stays well under the 150 characters a PR body link survives", () => {
    const url = screenshotUrl({
      repo: "afternoon/solid-groove",
      issue: 1234,
      id: "9999-15",
    });
    expect(url).toBe(
      "https://raw.githubusercontent.com/afternoon/solid-groove/refs/heads/claude/walkthroughs/1234/9999-15/1.png",
    );
    expect(url.length).toBeLessThan(150);
  });
});

describe("issue and comment text", () => {
  const ctx = {
    runUrl: "https://github.com/afternoon/solid-groove/actions/runs/1",
    build: "abc123",
    siteUrl: "https://trygroove.app",
    flows: [{ id: "CF-001", title: "A visitor reaches a playing loop" }],
  };

  it("an issue carries symptom, expected, steps, environment with the build, and the screenshot", () => {
    const body = issueBody(
      {
        ...finding(),
        alsoSeenIn: ["CF-004"],
        screenshotUrl: "https://example.test/1.png",
      },
      ctx,
    );
    expect(body).toContain("**Symptom:** Typing abc");
    expect(body).toContain("**Expected:** The field rejects");
    expect(body).toContain("1. Open a project.\n2. Type abc into the tempo field.");
    expect(body).toContain("build `abc123`");
    expect(body).toContain("CF-001 (A visitor reaches a playing loop), CF-004");
    expect(body).toContain("![CF-001 finding](https://example.test/1.png)");
    expect(body.endsWith("_Generated by [Claude Code](https://claude.ai/code)_")).toBe(
      true,
    );
  });

  it("a re-seen comment names the run, the build and each sighting", () => {
    const body = reseenComment({ number: 5, findings: [finding()] }, ctx);
    expect(body).toContain("Seen again by the QA sweep");
    expect(body).toContain("build `abc123`");
    expect(body).toContain("While walking CF-001");
  });

  it("the summary lists flows covered, issues filed, re-seen and over the cap", () => {
    const body = summaryBody({
      date: "2026-10-05",
      runUrl: ctx.runUrl,
      build: "abc123",
      limits: { agents: 5, issues: 1 },
      flows: [
        { id: "CF-001", title: "One", parked: false },
        { id: "CF-002", title: "Two", parked: true },
        { id: "CF-003", title: "Three", parked: false },
      ],
      reports: [
        { flow: "CF-001", ok: true, findings: [finding()], rejected: [], notes: "" },
        { flow: "CF-002", ok: false, error: "no findings.json", findings: [] },
      ],
      filed: [{ ...finding(), number: 101 }],
      reseen: [{ number: 5, findings: [finding({ flow: "CF-001" })] }],
      overCap: [finding({ title: "Bug: Later", severity: "low" })],
      cleanup: [
        { flow: "CF-001", ok: true, deleted: 2, remaining: 0 },
        { flow: "CF-002", ok: false, deleted: 0, remaining: 1 },
      ],
    });
    expect(body).toContain("| CF-001 One | walked | 1 | yes (2) |");
    expect(body).toContain(
      "| CF-002 Two _(parked)_ | **agent failed** | – | **no** (1 left) |",
    );
    expect(body).toContain("| CF-003 Three | **no report** | – | **unknown** |");
    expect(body).toContain("### Issues filed (1)\n\n- #101 (CF-001)");
    expect(body).toContain("### Issues re-seen (1)\n\n- #5 (CF-001)");
    expect(body).toContain("Not filed: over the cap of 1 (1)");
    expect(body).toContain("- Bug: Later (CF-001, low)");
  });
});

describe("agent text is pasted in safely", () => {
  it("breaks every @mention so nobody is pinged and claude.yml does not start", () => {
    const out = neutralizeMentions(
      "ask @claude and @some-user, mail a@b.co; a lone @ stays",
    );
    expect(out).not.toMatch(/@[A-Za-z0-9_-]/);
    expect(out.replaceAll("\u200b", "")).toBe(
      "ask @claude and @some-user, mail a@b.co; a lone @ stays",
    );
  });

  it("a finding and the notes reach the issue, the comment and the summary with no live mention", () => {
    const report = readReport(
      JSON.stringify({
        notes: "cc @afternoon",
        findings: [
          {
            title: "Bug: @claude fix the tempo",
            symptom: "@claude please fix",
            expected: "No @mention",
            steps: ["Type @claude into the name field."],
          },
        ],
      }),
      "CF-001",
    );
    const [found] = report.findings;
    const ctx = { runUrl: "r", build: "b", siteUrl: "s", flows: [] };
    const texts = [
      issueBody({ ...found, alsoSeenIn: [] }, ctx),
      reseenComment({ number: 1, findings: [found] }, ctx),
      found.title,
      report.notes,
    ];
    for (const text of texts) expect(text).not.toMatch(/@[A-Za-z0-9_-]/);
    expect(texts[0]).not.toContain("@claude");
  });

  it("caps a body under GitHub's 65,536-character limit and keeps the footer", () => {
    const steps = Array.from({ length: 30 }, () => "x".repeat(4000));
    const report = readReport(
      JSON.stringify({
        findings: [
          {
            title: "Bug: Long",
            symptom: "y".repeat(5000),
            expected: "z".repeat(5000),
            steps,
          },
        ],
      }),
      "CF-001",
    );
    const body = issueBody(
      { ...report.findings[0], alsoSeenIn: [] },
      { runUrl: "r", build: "b", siteUrl: "s", flows: [] },
    );
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(body).toContain("cut to 60000 characters");
    expect(body.endsWith("_Generated by [Claude Code](https://claude.ai/code)_")).toBe(
      true,
    );
    expect(capBody("short")).toBe("short");
  });
});

describe("fileFindings", () => {
  const ctx = { runUrl: "r", build: "b", siteUrl: "s", flows: [] };
  const planOf = () => ({
    file: [
      { ...finding({ title: "Bug: One" }), alsoSeenIn: [] },
      { ...finding({ title: "Bug: Two" }), alsoSeenIn: [] },
      { ...finding({ title: "Bug: Three" }), alsoSeenIn: [] },
    ],
    reseen: [{ number: 7, title: "Bug: Old", findings: [finding()] }],
    overCap: [],
  });

  it("a failed write is recorded and the rest still go, and the summary still renders", () => {
    const plan = planOf();
    const writes = [];
    let next = 100;
    const post = (path, body) => {
      writes.push(path);
      if (body.title === "Bug: Two")
        throw new Error("Command failed: gh api\nHTTP 422: body is too long");
      return { number: next++ };
    };
    const failures = fileFindings({ plan, ctx, repo: "o/r", post, log: () => {} });

    expect(writes).toEqual([
      "repos/o/r/issues",
      "repos/o/r/issues",
      "repos/o/r/issues",
      "repos/o/r/issues/7/comments",
    ]);
    expect(failures).toEqual([
      { what: 'filing "Bug: Two"', error: "Command failed: gh api" },
    ]);
    expect(plan.file.map((f) => f.number)).toEqual([100, undefined, 101]);

    const body = summaryBody({
      date: "2026-10-05",
      runUrl: "r",
      build: "b",
      limits: { agents: 1, issues: 15 },
      flows: [{ id: "CF-001", title: "One", parked: false }],
      reports: [{ flow: "CF-001", ok: true, findings: [], rejected: [], notes: "" }],
      filed: plan.file,
      reseen: plan.reseen,
      overCap: [],
      cleanup: [{ flow: "CF-001", ok: true, deleted: 1 }],
      failures,
    });
    expect(body).toContain("- #100 (CF-001)");
    expect(body).toContain("- Bug: Two (CF-001) **not filed: the write failed**");
    expect(body).toContain("- #101 (CF-001)");
    expect(body).toContain(
      '### GitHub writes that failed (1)\n\n- filing "Bug: Two": Command failed: gh api',
    );
  });

  it("a dry run writes nothing", () => {
    const post = () => {
      throw new Error("must not write");
    };
    const failures = fileFindings({
      plan: planOf(),
      ctx,
      repo: "o/r",
      post,
      dryRun: true,
      log: () => {},
    });
    expect(failures).toEqual([]);
  });
});

describe("resolveScreenshot", () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it("accepts a real PNG inside the directory", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-shot-"));
    mkdirSync(join(dir, "shots"));
    writeFileSync(join(dir, "shots", "a.png"), PNG);
    expect(resolveScreenshot(dir, "shots/a.png")).toMatch(/shots\/a\.png$/);
  });

  it("rejects a symlink, a symlinked directory, a non-PNG and a missing file", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-shot-"));
    const outside = mkdtempSync(join(tmpdir(), "qa-outside-"));
    try {
      writeFileSync(join(outside, "secret.png"), PNG);
      symlinkSync(join(outside, "secret.png"), join(dir, "link.png"));
      symlinkSync(outside, join(dir, "linked"));
      writeFileSync(join(dir, "fake.png"), "refresh_token=abc");
      expect(resolveScreenshot(dir, "link.png")).toBeNull();
      expect(resolveScreenshot(dir, "linked/secret.png")).toBeNull();
      expect(resolveScreenshot(dir, "fake.png")).toBeNull();
      expect(resolveScreenshot(dir, "missing.png")).toBeNull();
      expect(resolveScreenshot(dir, "../x.png")).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
