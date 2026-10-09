import { describe, expect, it } from "vitest";
import { addDevice, setParameter } from "../../commands";
import { createDevice } from "../../domain/devices";
import { createFactoryContext } from "../../domain/factories";
import { createSeededIdFactory } from "../../domain/ids";
import {
  createScriptedAssistantProvider,
  replyEvents,
  toolUseEvents,
} from "../../testing/scriptedAssistantProvider";
import { ASSISTANT_PROMPT_VERSION, ASSISTANT_SYSTEM_PROMPT } from "../prompt";
import { toolNameFor } from "../tools";
import { EVAL_CASES, type EvalCase } from "./cases";
import { createHouseLoopProject } from "./fixtures";
import { formatTally, renderMarkdown } from "./markdown";
import { buildReport, evaluateRecords, runEvals } from "./run";

const glue = EVAL_CASES.find((entry) => entry.id === "process-glue") as EvalCase;
const crushed = EVAL_CASES.find((entry) => entry.id === "process-crushed") as EvalCase;

function compressorCall(seed: string, threshold: number) {
  const device = {
    ...createDevice(
      createFactoryContext({ ids: createSeededIdFactory(seed) }).ids("device"),
      "compressor",
      0,
    ),
    parameters: { threshold, ratio: 2 },
  };
  const command = addDevice({ chain: "master" }, device);
  return { name: toolNameFor(command.type), input: command.payload };
}

const fixedNow = () => Date.parse("2026-10-09T12:00:00Z");

describe("runEvals", () => {
  it("runs each case N times through the gateway and judges every check", async () => {
    const project = createHouseLoopProject();
    const bass = project.song.tracks.find((track) => track.name === "Bass");
    const bassDown = setParameter(
      {
        scope: "track",
        trackId: bass?.id ?? project.song.tracks[1].id,
        parameterId: "track.volume",
      },
      -4,
    );
    const provider = createScriptedAssistantProvider([
      // process-glue, run 1 and 2: the same gentle compressor.
      toolUseEvents("A Compressor on the master to glue it.", [compressorCall("a", -18)]),
      toolUseEvents("A Compressor on the master to glue it.", [compressorCall("b", -18)]),
      // process-crushed, run 1: the same compressor again (flattened); run 2:
      // a crushed one that also reaches outside its scope.
      toolUseEvents("Crushing it.", [compressorCall("c", -18)]),
      toolUseEvents("Crushing it, and the Bass volume down.", [
        compressorCall("d", -50),
        { name: toolNameFor(bassDown.type), input: bassDown.payload },
      ]),
    ]);
    const report = await runEvals({
      provider,
      cases: [glue, crushed],
      runs: 2,
      now: fixedNow,
    });

    expect(provider.requests).toHaveLength(4);
    expect(provider.requests[0].system[0].text).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(provider.requests[0].tools.length).toBeGreaterThan(0);
    expect(provider.requests[0].messages).toEqual([
      { role: "user", content: glue.request },
    ]);

    expect(report.promptVersion).toBe(ASSISTANT_PROMPT_VERSION);
    expect(report.model).toBe("claude-sonnet-5");
    expect(report.records.map((record) => [record.caseId, record.run])).toEqual([
      ["process-glue", 1],
      ["process-glue", 2],
      ["process-crushed", 1],
      ["process-crushed", 2],
    ]);
    const [, , flattened, wild] = report.records;
    expect(flattened.checks.notFlattened?.status).toBe("fail");
    expect(wild.checks.notFlattened?.status).toBe("pass");
    expect(wild.checks.inScope?.status).toBe("fail");
    expect(report.records[0].checks.notFlattened).toBeUndefined();
    expect(report.summary.checks.valid).toEqual({ pass: 4, fail: 0, skip: 0 });
    expect(report.summary.checks.inScope).toEqual({ pass: 3, fail: 1, skip: 0 });
    expect(report.summary.checks.notFlattened).toEqual({ pass: 1, fail: 1, skip: 0 });
    expect(report.records[3].stats?.deviceParameters).toEqual([
      "Compressor threshold=-50 ratio=2",
    ]);
    expect(report.records[3].stats?.mixer).toEqual(["Bass volume=-4 pan=0"]);
  });

  it("records a reply with no proposal, and a failed turn, as invalid", async () => {
    const provider = createScriptedAssistantProvider([
      replyEvents(["Which part should I compress?"]),
      [{ fail: "rejected", status: 401 }],
    ]);
    const report = await runEvals({ provider, cases: [glue], runs: 2, now: fixedNow });
    const [question, failed] = report.records;
    expect(question.checks.valid).toEqual({
      status: "fail",
      detail: "The reply proposed no change",
    });
    expect(question.checks.bundled?.status).toBe("skip");
    expect(failed.error).toMatch(/^provider_error/);
    expect(failed.checks.valid?.status).toBe("fail");
    expect(report.summary.checks.grounded).toEqual({ pass: 0, fail: 0, skip: 2 });
  });

  it("replays a saved report's proposals against the checks without a model", async () => {
    const provider = createScriptedAssistantProvider([
      toolUseEvents("A Compressor on the master.", [compressorCall("a", -18)]),
    ]);
    const report = await runEvals({ provider, cases: [glue], runs: 1, now: fixedNow });
    const saved = JSON.parse(JSON.stringify(report));
    const replayed = buildReport(evaluateRecords(saved.records, [glue]), [glue], {
      generatedAt: saved.generatedAt,
      model: saved.model,
      runsPerCase: 1,
    });
    expect(replayed.records[0].checks).toEqual(report.records[0].checks);
    expect(provider.requests).toHaveLength(1);
  });
});

describe("renderMarkdown", () => {
  it("names the model and prompt version and gives the pass rate per check", async () => {
    const provider = createScriptedAssistantProvider([
      toolUseEvents("A Compressor on the master.", [compressorCall("a", -18)]),
      replyEvents(["No."]),
    ]);
    const report = await runEvals({
      provider,
      cases: [glue, crushed],
      runs: 1,
      now: fixedNow,
    });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("Model: `claude-sonnet-5`");
    expect(markdown).toContain(`Prompt version: \`${ASSISTANT_PROMPT_VERSION}\``);
    expect(markdown).toContain("| 1. Valid | 1/2 (50%) |");
    expect(markdown).toContain(
      "| 6. Extreme is not flattened | 0/0 (n/a, 1 not judged) |",
    );
    expect(markdown).toContain("1. Valid failed: The reply proposed no change");
  });

  it("formats a tally over the proposals a check could judge", () => {
    expect(formatTally({ pass: 2, fail: 1, skip: 0 })).toBe("2/3 (67%)");
    expect(formatTally(undefined)).toBe("n/a");
  });
});
