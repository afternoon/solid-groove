/**
 * The assistant gateway (#69, ADR 0006): one authenticated turn, from the
 * browser's request to a validated, streamed reply.
 *
 * Firebase-free and SDK-free, like `src/access/signInGate.ts`: the Cloud
 * Function (`functions/src/assistant.ts`) supplies the caller, the provider
 * and a logger, and maps the result onto a callable response. Everything that
 * decides anything is here, and is tested here against a scripted provider.
 *
 * A turn:
 *
 * 1. refuses a caller with no account, or a guest (`unauthenticated`);
 * 2. parses the request, whose project context is the ADR 0007 allowlist
 *    (`invalid_request`);
 * 3. builds the per-model provider request with a bounded history;
 * 4. calls the provider, streaming the reply's text as it arrives, under a
 *    per-attempt timeout, retrying a transient failure that has not streamed
 *    anything yet, and abandoning the call if the browser goes away;
 * 5. validates the reply and logs one redacted record of how it went.
 */
import {
  ASSISTANT_CALL_LIMITS,
  ASSISTANT_HISTORY_TOKEN_BUDGET,
  ASSISTANT_MODEL_ID,
  ASSISTANT_MODELS,
  type AssistantCallLimits,
  type AssistantModelProfile,
  CONTEXT_WINDOW_MARGIN_TOKENS,
  SMALLEST_CONTEXT_WINDOW_TOKENS,
} from "./config";
import { type BoundedHistory, boundHistory, estimateTokens } from "./history";
import { ASSISTANT_PROMPT_VERSION, buildSystemBlocks } from "./prompt";
import {
  AssistantGatewayError,
  type AssistantStopReason,
  type AssistantStreamChunk,
  type AssistantTurnRequest,
  type AssistantTurnResult,
  assistantTurnRequestSchema,
} from "./protocol";
import { type AssistantProvider, ProviderFailure } from "./provider";
import { buildProviderRequest, type ProviderMessagesRequest } from "./providerRequest";
import { NO_USAGE, type ProviderUsage, StreamReader } from "./streamEvents";
import { type AssistantTurnLog, toTurnLog } from "./telemetry";

/** Who is calling, as the function's auth context reports it. */
export interface AssistantCaller {
  readonly uid: string | null;
  /** `firebase.sign_in_provider` from the ID token, e.g. `google.com`. */
  readonly signInProvider: string | null;
}

export interface AssistantGatewayDeps {
  readonly provider: AssistantProvider;
  readonly log: (record: AssistantTurnLog) => void;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  /** Waits `ms`, or rejects once `signal` aborts. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly model?: AssistantModelProfile;
  readonly limits?: AssistantCallLimits;
}

export interface AssistantTurnOptions {
  /** Aborts when the browser disconnects. */
  readonly signal: AbortSignal;
  /** Receives the reply's text as it streams. */
  readonly onChunk: (chunk: AssistantStreamChunk) => unknown;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The account's ID as the provider sees it: a SHA-256 of the Firebase uid,
 * which is already pseudonymous, so even that never leaves verbatim.
 */
export async function pseudonymousUserId(uid: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function authenticate(caller: AssistantCaller): string {
  if (!caller.uid) {
    throw new AssistantGatewayError("unauthenticated", "Sign in to use the assistant.");
  }
  if (caller.signInProvider === "anonymous") {
    throw new AssistantGatewayError(
      "unauthenticated",
      "The assistant needs a signed-in account, not a guest session.",
    );
  }
  return caller.uid;
}

function parseRequest(raw: unknown): AssistantTurnRequest {
  const parsed = assistantTurnRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AssistantGatewayError(
      "invalid_request",
      "The assistant request was not valid.",
    );
  }
  return parsed.data;
}

/**
 * The history budget for one turn: the configured ceiling, or what is left of
 * the smallest window once the system prompt, the project context and the
 * reply are accounted for, whichever is less.
 */
export function historyBudgetFor(
  systemTokens: number,
  models: readonly AssistantModelProfile[] = Object.values(ASSISTANT_MODELS),
): number {
  const largestReply = Math.max(...models.map((model) => model.maxOutputTokens));
  const room =
    SMALLEST_CONTEXT_WINDOW_TOKENS -
    largestReply -
    systemTokens -
    CONTEXT_WINDOW_MARGIN_TOKENS;
  return Math.min(ASSISTANT_HISTORY_TOKEN_BUDGET, room);
}

interface PreparedTurn {
  readonly request: ProviderMessagesRequest;
  readonly history: BoundedHistory;
}

async function prepare(
  model: AssistantModelProfile,
  uid: string,
  turn: AssistantTurnRequest,
): Promise<PreparedTurn> {
  const system = buildSystemBlocks(turn.context);
  const systemTokens = system.reduce((sum, block) => sum + estimateTokens(block.text), 0);
  const history = boundHistory(turn.messages, historyBudgetFor(systemTokens));
  if (history.messages.length === 0) {
    throw new AssistantGatewayError(
      "invalid_request",
      "The selection and message are too large for the assistant to read at once.",
    );
  }
  const request = buildProviderRequest(model, {
    system,
    messages: history.messages.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    pseudonymousUserId: await pseudonymousUserId(uid),
  });
  return { request, history };
}

/** The outcome of one provider call. */
type AttemptOutcome =
  | { kind: "completed"; text: string; stopReason: AssistantStopReason }
  | { kind: "failed"; failure: ProviderFailure; streamedText: boolean }
  | { kind: "timed_out" }
  | { kind: "cancelled" };

interface Attempt {
  readonly outcome: AttemptOutcome;
  readonly usage: ProviderUsage;
}

/**
 * One provider call under a timeout and the browser's cancellation. Each
 * `next()` races the abort, so a provider that ignores its signal still
 * cannot hold the turn past the timeout.
 */
async function attemptCall(
  deps: AssistantGatewayDeps,
  request: ProviderMessagesRequest,
  options: AssistantTurnOptions,
  timeoutMs: number,
): Promise<Attempt> {
  const controller = new AbortController();
  let timedOut = false;
  const onCancel = () => controller.abort();
  options.signal.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const aborted = new Promise<"aborted">((resolve) => {
    if (controller.signal.aborted) resolve("aborted");
    controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });

  const reader = new StreamReader();
  let iterator: AsyncIterator<unknown> | undefined;
  const stopped = (): AttemptOutcome =>
    timedOut ? { kind: "timed_out" } : { kind: "cancelled" };
  try {
    if (options.signal.aborted)
      return { outcome: { kind: "cancelled" }, usage: NO_USAGE };
    iterator = deps.provider.stream(request, controller.signal)[Symbol.asyncIterator]();
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next === "aborted") return { outcome: stopped(), usage: reader.usage };
      if (next.done) break;
      const text = reader.accept(next.value);
      if (text) await options.onChunk({ type: "text", text });
    }
    if (controller.signal.aborted) return { outcome: stopped(), usage: reader.usage };
    const result = reader.result();
    return { outcome: { kind: "completed", ...result }, usage: reader.usage };
  } catch (error) {
    if (controller.signal.aborted) return { outcome: stopped(), usage: reader.usage };
    const failure =
      error instanceof ProviderFailure ? error : new ProviderFailure("malformed");
    return {
      outcome: { kind: "failed", failure, streamedText: reader.hasText },
      usage: reader.usage,
    };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onCancel);
    if (controller.signal.aborted) void iterator?.return?.()?.catch(() => {});
  }
}

function addUsage(a: ProviderUsage, b: ProviderUsage): ProviderUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

function errorForFailure(failure: ProviderFailure): AssistantGatewayError {
  switch (failure.kind) {
    case "rejected":
      return new AssistantGatewayError(
        "provider_error",
        "The assistant could not take that request.",
      );
    case "malformed":
      return new AssistantGatewayError(
        "malformed_response",
        "The assistant's reply came back garbled. Try again.",
      );
    default:
      return new AssistantGatewayError(
        "provider_unavailable",
        "The assistant is busy right now. Try again in a moment.",
      );
  }
}

/**
 * Runs one assistant turn. Resolves with the validated reply, or rejects with
 * an {@link AssistantGatewayError}; either way it logs exactly one
 * {@link AssistantTurnLog}.
 */
export async function runAssistantTurn(
  deps: AssistantGatewayDeps,
  caller: AssistantCaller,
  rawRequest: unknown,
  options: AssistantTurnOptions,
): Promise<AssistantTurnResult> {
  const model = deps.model ?? ASSISTANT_MODELS[ASSISTANT_MODEL_ID];
  const limits = deps.limits ?? ASSISTANT_CALL_LIMITS;
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = deps.now();
  const failures: { kind: ProviderFailure["kind"]; status: number | null }[] = [];
  let attempts = 0;
  let usage = NO_USAGE;
  let history: BoundedHistory = { messages: [], dropped: 0 };

  const finish = (
    outcome: AssistantTurnLog["outcome"],
    stopReason: AssistantStopReason | null,
  ) =>
    deps.log(
      toTurnLog({
        outcome,
        model: model.id,
        promptVersion: ASSISTANT_PROMPT_VERSION,
        failures,
        attempts,
        stopReason,
        durationMs: deps.now() - startedAt,
        usage,
        historySent: history.messages.length,
        historyDropped: history.dropped,
      }),
    );

  try {
    const uid = authenticate(caller);
    const turn = parseRequest(rawRequest);
    const prepared = await prepare(model, uid, turn);
    history = prepared.history;

    while (true) {
      attempts += 1;
      const attempt = await attemptCall(
        deps,
        prepared.request,
        options,
        limits.attemptTimeoutMs,
      );
      usage = addUsage(usage, attempt.usage);
      const { outcome } = attempt;
      if (outcome.kind === "completed") {
        finish("completed", outcome.stopReason);
        return {
          text: outcome.text,
          stopReason: outcome.stopReason,
          model: model.id,
          promptVersion: ASSISTANT_PROMPT_VERSION,
        };
      }
      if (outcome.kind === "cancelled") {
        throw new AssistantGatewayError(
          "cancelled",
          "The assistant request was cancelled.",
        );
      }
      if (outcome.kind === "timed_out") {
        throw new AssistantGatewayError(
          "timeout",
          "The assistant took too long to answer. Try again.",
        );
      }
      failures.push({ kind: outcome.failure.kind, status: outcome.failure.status });
      const retry =
        outcome.failure.transient &&
        !outcome.streamedText &&
        attempts < limits.maxAttempts;
      if (!retry) throw errorForFailure(outcome.failure);
      try {
        await sleep(limits.retryBackoffMs * 2 ** (attempts - 1), options.signal);
      } catch {
        throw new AssistantGatewayError(
          "cancelled",
          "The assistant request was cancelled.",
        );
      }
    }
  } catch (error) {
    if (error instanceof AssistantGatewayError) {
      finish(error.code, null);
      throw error;
    }
    finish("malformed_response", null);
    throw error;
  }
}
