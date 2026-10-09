/**
 * Running the assistant's musical evals (GRV-6).
 *
 * Each case runs N times through {@link runAssistantTurn}, the gateway's own
 * turn, so the model sees exactly what production sends it: the production
 * system prompt, the project context built by `buildAssistantPayload`, the
 * tool schema and the per-model request. Only the surroundings differ: the
 * caller is a fixed eval account, the guard stores are in memory (so nothing
 * touches Firestore or the deployed gateway's quota), and the provider is
 * whatever the caller hands in. `scripts/eval-assistant.ts` hands in the live
 * one; tests hand in a scripted one.
 *
 * Each turn's reply is kept whole (its text and its proposal), and every check
 * is judged from what was kept, so {@link evaluateRecords} can replay a saved
 * report's proposals against the current checks without calling anything.
 */
import {
  ASSISTANT_MODEL_ID,
  ASSISTANT_MODELS,
  type AssistantModelProfile,
} from "../config";
import { type AssistantGatewayDeps, runAssistantTurn } from "../gateway";
import { createInMemoryGuardStores } from "../inMemoryGuardStores";
import { buildAssistantPayload } from "../payload";
import { ASSISTANT_PROMPT_VERSION } from "../prompt";
import {
  AssistantGatewayError,
  type AssistantProposal,
  type AssistantStopReason,
} from "../protocol";
import type { AssistantProvider } from "../provider";
import { ASSISTANT_TOOLSET_VERSION } from "../tools";
import { casePairs, type EvalCase, resolveScope, resolveSelection } from "./cases";
import {
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  checkAtomicUndo,
  checkBundled,
  checkGrounded,
  checkInScope,
  checkNotFlattened,
  checkValid,
  proposalFingerprint,
  skip,
} from "./checks";
import { describeProposal, type ProposalStats } from "./describe";

/** What one turn came back with, or how it failed. */
export interface EvalTurn {
  readonly durationMs: number;
  /** The gateway's error code and message, when the turn failed. */
  readonly error: string | null;
  readonly stopReason: AssistantStopReason | null;
  readonly text: string;
  readonly proposal: AssistantProposal | null;
}

/** One run of one case: the request, everything the model returned, every check. */
export interface EvalRecord extends EvalTurn {
  readonly caseId: string;
  readonly capability: EvalCase["capability"];
  readonly axis: EvalCase["axis"];
  readonly request: string;
  /** 1-based. Check 6 compares across all of a pair's runs. */
  readonly run: number;
  /** Check 6 is only judged on an extreme case's records. */
  readonly checks: Partial<Record<CheckId, CheckResult>>;
  readonly stats: ProposalStats | null;
  /** The proposal with its fresh IDs normalised; null when it did not apply. */
  readonly fingerprint: string | null;
}

export type Tally = Record<CheckResult["status"], number>;

export interface EvalReport {
  readonly generatedAt: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly toolsetVersion: number;
  readonly runsPerCase: number;
  readonly caseIds: readonly string[];
  readonly records: readonly EvalRecord[];
  readonly summary: {
    readonly checks: Record<CheckId, Tally>;
    readonly cases: Record<string, Partial<Record<CheckId, Tally>>>;
  };
}

/**
 * The in-memory guards' limits: high enough that a full run never trips them.
 * Production's quota and spend ceiling are for producers, and nothing here
 * counts against them.
 */
const EVAL_GUARD_LIMITS: NonNullable<AssistantGatewayDeps["guardLimits"]> = {
  requestsPerWindow: 100_000,
  windowMs: 24 * 60 * 60 * 1000,
  dailySpendCeilingUsd: 1_000,
};

const EVAL_CALLER = { uid: "assistant-evals", signInProvider: "password" } as const;

export interface RunTurnOptions {
  readonly provider: AssistantProvider;
  readonly model?: AssistantModelProfile;
  readonly now?: () => number;
}

/** Runs one case once through the gateway's own turn. Never throws for a failed turn. */
export async function runCaseTurn(
  evalCase: EvalCase,
  options: RunTurnOptions,
): Promise<EvalTurn> {
  const now = options.now ?? Date.now;
  const project = evalCase.fixture();
  const context = buildAssistantPayload(
    project,
    resolveSelection(project, evalCase.selection),
  );
  const startedAt = now();
  try {
    const result = await runAssistantTurn(
      {
        provider: options.provider,
        guards: createInMemoryGuardStores(),
        log: () => {},
        now,
        model: options.model,
        guardLimits: EVAL_GUARD_LIMITS,
      },
      EVAL_CALLER,
      {
        projectRevision: project.metadata.revision,
        messages: [{ role: "user", text: evalCase.request }],
        context,
      },
      { signal: new AbortController().signal, onChunk: () => {} },
    );
    return {
      durationMs: now() - startedAt,
      error: null,
      stopReason: result.stopReason,
      text: result.text,
      proposal: result.proposal,
    };
  } catch (error) {
    const reason =
      error instanceof AssistantGatewayError
        ? `${error.code}: ${error.message}`
        : `internal_error: ${error instanceof Error ? error.message : String(error)}`;
    return {
      durationMs: now() - startedAt,
      error: reason,
      stopReason: null,
      text: "",
      proposal: null,
    };
  }
}

/** Checks 1 to 5 on one turn, and its descriptive numbers. */
export function evaluateTurn(
  evalCase: EvalCase,
  run: number,
  turn: EvalTurn,
): EvalRecord {
  const base = {
    ...turn,
    caseId: evalCase.id,
    capability: evalCase.capability,
    axis: evalCase.axis,
    request: evalCase.request,
    run,
  };
  const project = evalCase.fixture();
  const valid = turn.error
    ? {
        result: { status: "fail" as const, detail: `The turn failed: ${turn.error}` },
        applied: null,
      }
    : checkValid(project, turn.proposal);
  if (!valid.applied) {
    const notJudged = skip("The proposal did not apply");
    return {
      ...base,
      checks: {
        valid: valid.result,
        bundled: notJudged,
        inScope: notJudged,
        atomicUndo: notJudged,
        grounded: notJudged,
      },
      stats: null,
      fingerprint: null,
    };
  }
  const { proposal, after } = valid.applied;
  return {
    ...base,
    checks: {
      valid: valid.result,
      bundled: checkBundled(proposal.commands, after),
      inScope: checkInScope(project, after, resolveScope(project, evalCase.scope)),
      atomicUndo: checkAtomicUndo(project, turn.proposal),
      grounded: checkGrounded(project, after, proposal.impact.controls, turn.text),
    },
    stats: describeProposal(project, after, proposal.commands.length),
    fingerprint: proposalFingerprint(project, proposal.commands),
  };
}

/** Check 6 on every extreme record, against its pair's conventional records. */
export function judgeFlattening(
  records: readonly EvalRecord[],
  cases: readonly EvalCase[],
): EvalRecord[] {
  const conventionalOf = new Map(
    casePairs(cases).map((pair) => [pair.extreme.id, pair.conventional.id]),
  );
  return records.map((record) => {
    const conventionalId = conventionalOf.get(record.caseId);
    if (!conventionalId) return record;
    const conventional = records
      .filter((candidate) => candidate.caseId === conventionalId)
      .map((candidate) => candidate.fingerprint);
    return {
      ...record,
      checks: {
        ...record.checks,
        notFlattened: checkNotFlattened(record.fingerprint, conventional),
      },
    };
  });
}

function emptyTally(): Tally {
  return { pass: 0, fail: 0, skip: 0 };
}

export function summarize(records: readonly EvalRecord[]): EvalReport["summary"] {
  const checks = Object.fromEntries(CHECK_IDS.map((id) => [id, emptyTally()])) as Record<
    CheckId,
    Tally
  >;
  const cases: Record<string, Partial<Record<CheckId, Tally>>> = {};
  for (const record of records) {
    const perCase = cases[record.caseId] ?? {};
    cases[record.caseId] = perCase;
    for (const id of CHECK_IDS) {
      const result = record.checks[id];
      if (!result) continue;
      checks[id][result.status] += 1;
      const tally = perCase[id] ?? emptyTally();
      tally[result.status] += 1;
      perCase[id] = tally;
    }
  }
  return { checks, cases };
}

export interface ReportMeta {
  readonly generatedAt: string;
  readonly model: string;
  readonly promptVersion?: string;
  readonly toolsetVersion?: number;
  readonly runsPerCase: number;
}

/** Judges check 6 and builds the report from records that carry checks 1 to 5. */
export function buildReport(
  records: readonly EvalRecord[],
  cases: readonly EvalCase[],
  meta: ReportMeta,
): EvalReport {
  const judged = judgeFlattening(records, cases);
  return {
    generatedAt: meta.generatedAt,
    model: meta.model,
    promptVersion: meta.promptVersion ?? ASSISTANT_PROMPT_VERSION,
    toolsetVersion: meta.toolsetVersion ?? ASSISTANT_TOOLSET_VERSION,
    runsPerCase: meta.runsPerCase,
    caseIds: cases.map((entry) => entry.id),
    records: judged,
    summary: summarize(judged),
  };
}

/**
 * Re-judges kept turns against the current checks: a saved report's
 * proposals replayed without calling the model.
 */
export function evaluateRecords(
  turns: readonly (EvalTurn & { readonly caseId: string; readonly run: number })[],
  cases: readonly EvalCase[],
): EvalRecord[] {
  return turns.map((turn) => {
    const evalCase = cases.find((entry) => entry.id === turn.caseId);
    if (!evalCase) throw new Error(`No eval case "${turn.caseId}"`);
    return evaluateTurn(evalCase, turn.run, turn);
  });
}

export interface RunEvalsOptions extends RunTurnOptions {
  readonly cases: readonly EvalCase[];
  readonly runs: number;
  /** Turns in flight at once. */
  readonly concurrency?: number;
  readonly onRecord?: (record: EvalRecord) => void;
}

/** Runs every case `runs` times and builds the report. */
export async function runEvals(options: RunEvalsOptions): Promise<EvalReport> {
  const model = options.model ?? ASSISTANT_MODELS[ASSISTANT_MODEL_ID];
  const now = options.now ?? Date.now;
  const jobs = options.cases.flatMap((evalCase) =>
    Array.from({ length: options.runs }, (_, index) => ({ evalCase, run: index + 1 })),
  );
  const records: EvalRecord[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      const { evalCase, run } = jobs[index];
      const turn = await runCaseTurn(evalCase, { ...options, model, now });
      const record = evaluateTurn(evalCase, run, turn);
      records[index] = record;
      options.onRecord?.(record);
    }
  };
  const lanes = Math.max(1, Math.min(options.concurrency ?? 1, jobs.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return buildReport(records, options.cases, {
    generatedAt: new Date(now()).toISOString(),
    model: model.id,
    runsPerCase: options.runs,
  });
}
