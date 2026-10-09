/**
 * `bun run eval:assistant`: the assistant's musical capability evals (GRV-6).
 *
 * Runs every case in `src/assistant/evals/cases.ts` (or the ones named) N
 * times against the **live model**, through the gateway's own turn with the
 * production system prompt and tool schema, on fixture projects only. It
 * never touches user data, Firestore or the deployed gateway's quota. On
 * demand only: by hand, never in per-push CI and never on a schedule.
 *
 *   bun run eval:assistant                       every case, 3 runs each
 *   bun run eval:assistant -- sketch-house       one case (or several)
 *   bun run eval:assistant -- --runs 5           N runs per case
 *   bun run eval:assistant -- --model claude-haiku-4-5
 *   bun run eval:assistant -- --out tmp/evals    where the report goes
 *   bun run eval:assistant -- --replay <report.json>
 *       re-judge a saved report's proposals with the current checks (no model call)
 *
 * It needs ANTHROPIC_API_KEY in the environment and says so, making no call,
 * when it is missing. Each run writes `report.json` (every request, reply,
 * proposal and check) and `report.md` (pass rate per check, then per case) to
 * `tmp/assistant-evals/<time>/` unless `--out` says otherwise.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAnthropicProvider } from "../functions/src/anthropicProvider";
import {
  ASSISTANT_API_KEY_SECRET,
  ASSISTANT_MODEL_ID,
  ASSISTANT_MODELS,
  type AssistantModelId,
} from "../src/assistant/config";
import { EVAL_CASES, type EvalCase } from "../src/assistant/evals/cases";
import { CHECK_IDS, CHECK_LABELS } from "../src/assistant/evals/checks";
import { formatTally, renderMarkdown } from "../src/assistant/evals/markdown";
import {
  buildReport,
  type EvalRecord,
  type EvalReport,
  evaluateRecords,
  runEvals,
} from "../src/assistant/evals/run";

interface Options {
  readonly caseIds: string[];
  readonly runs: number;
  readonly model: AssistantModelId;
  readonly out: string | null;
  readonly replay: string | null;
  readonly concurrency: number;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  const caseIds: string[] = [];
  let runs = Number(process.env.EVAL_RUNS ?? 3);
  let model: string = ASSISTANT_MODEL_ID;
  let out: string | null = null;
  let replay: string | null = null;
  let concurrency = 3;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => argv[++index] ?? fail(`${arg} needs a value`);
    if (arg === "--runs") runs = Number(value());
    else if (arg === "--model") model = value();
    else if (arg === "--out") out = value();
    else if (arg === "--replay") replay = value();
    else if (arg === "--concurrency") concurrency = Number(value());
    else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: bun run eval:assistant -- [case ...] [--runs N] [--model ID] [--out DIR] [--replay REPORT]\n\nCases: ${EVAL_CASES.map((entry) => entry.id).join(", ")}`,
      );
      process.exit(0);
    } else if (arg.startsWith("--")) fail(`Unknown option ${arg}`);
    else caseIds.push(arg);
  }
  if (!Number.isInteger(runs) || runs < 1)
    fail("--runs must be a whole number of at least 1");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    fail("--concurrency must be a whole number of at least 1");
  }
  if (!(model in ASSISTANT_MODELS)) {
    fail(
      `Unknown model "${model}". Configured: ${Object.keys(ASSISTANT_MODELS).join(", ")}`,
    );
  }
  return { caseIds, runs, model: model as AssistantModelId, out, replay, concurrency };
}

function selectCases(ids: readonly string[]): EvalCase[] {
  if (ids.length === 0) return [...EVAL_CASES];
  return ids.map(
    (id) =>
      EVAL_CASES.find((entry) => entry.id === id) ??
      fail(
        `No eval case "${id}". Cases: ${EVAL_CASES.map((entry) => entry.id).join(", ")}`,
      ),
  );
}

async function writeReport(report: EvalReport, out: string | null): Promise<string> {
  const dir =
    out ?? join("tmp", "assistant-evals", report.generatedAt.replace(/[:.]/g, "-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(dir, "report.md"), renderMarkdown(report));
  return dir;
}

function printSummary(report: EvalReport, dir: string): void {
  console.log(
    `\nModel ${report.model}, prompt ${report.promptVersion}, ${report.records.length} proposals`,
  );
  for (const id of CHECK_IDS) {
    console.log(
      `  ${CHECK_LABELS[id].padEnd(36)} ${formatTally(report.summary.checks[id])}`,
    );
  }
  console.log(`\nReport: ${join(dir, "report.md")} and ${join(dir, "report.json")}`);
}

async function replay(path: string, options: Options): Promise<void> {
  const saved = JSON.parse(await readFile(path, "utf8")) as EvalReport;
  const cases = selectCases(saved.caseIds as string[]);
  const records = evaluateRecords(saved.records as EvalRecord[], cases);
  const report = buildReport(records, cases, {
    generatedAt: new Date().toISOString(),
    model: saved.model,
    promptVersion: saved.promptVersion,
    toolsetVersion: saved.toolsetVersion,
    runsPerCase: saved.runsPerCase,
  });
  printSummary(report, await writeReport(report, options.out));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.replay) return replay(options.replay, options);

  const cases = selectCases(options.caseIds);
  const apiKey = process.env[ASSISTANT_API_KEY_SECRET];
  if (!apiKey) {
    fail(
      `${ASSISTANT_API_KEY_SECRET} is not set (or is empty). The assistant evals run against the live model and need an API key in the environment, e.g.\n\n  ${ASSISTANT_API_KEY_SECRET}=sk-ant-... bun run eval:assistant\n\nNo model was called.`,
    );
  }
  const model = ASSISTANT_MODELS[options.model];
  console.log(
    `Running ${cases.length} cases x ${options.runs} runs against ${model.id} (the live model)...`,
  );
  const report = await runEvals({
    provider: createAnthropicProvider({ apiKey }),
    model,
    cases,
    runs: options.runs,
    concurrency: options.concurrency,
    onRecord(record) {
      const marks = CHECK_IDS.map((id) => {
        const status = record.checks[id]?.status;
        return status === "pass"
          ? "+"
          : status === "fail"
            ? "x"
            : status === "skip"
              ? "."
              : " ";
      }).join("");
      console.log(
        `  [${marks}] ${record.caseId} run ${record.run}${record.error ? ` (${record.error})` : ""}`,
      );
    },
  });
  printSummary(report, await writeReport(report, options.out));
}

await main();
