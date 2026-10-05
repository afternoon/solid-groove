/**
 * The assistant gateway's configuration (#69, ADR 0006 decisions 2 and 7).
 *
 * Every number the gateway, its limits and the copy that describes them need
 * is written down here and nowhere else: which model answers, how each model
 * wants its request shaped, how long one provider call may take, how often a
 * failed one is retried, and how much conversation is resent per turn.
 * Switching models is a change to {@link ASSISTANT_MODEL_ID} and nothing else
 * (ADR 0006 decision 2: the product owner's call, from dogfooding).
 *
 * Like `src/domain`, this module imports nothing from Firebase, Tone or Solid,
 * and nothing from the provider's SDK: the Cloud Function
 * (`functions/src/assistant.ts`) is the only place that touches either.
 */

/**
 * How a model wants extended thinking asked for. The models under evaluation
 * do not take the same request (ADR 0006 decision 3):
 *
 * - `adaptive`: `thinking: { type: "adaptive" }` with the depth set by
 *   `output_config.effort`. Claude Sonnet 5.
 * - `budget`: `thinking: { type: "enabled", budget_tokens }`, and **no**
 *   `effort`, which this model rejects. Claude Haiku 4.5.
 */
export type ThinkingShape =
  | { readonly kind: "adaptive"; readonly effort: "low" | "medium" | "high" }
  | { readonly kind: "budget"; readonly budgetTokens: number };

/** One model the gateway can be pointed at, and the request it takes. */
export interface AssistantModelProfile {
  /** The provider's model ID, sent verbatim. */
  readonly id: string;
  /** The model's context window, in tokens. */
  readonly contextWindowTokens: number;
  /** The most the gateway lets one reply run to, thinking included. */
  readonly maxOutputTokens: number;
  readonly thinking: ThinkingShape;
}

/**
 * Every model the gateway is configured to call. A model missing from here
 * cannot be selected, so a request shape is never guessed.
 */
export const ASSISTANT_MODELS = {
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 16_000,
    thinking: { kind: "adaptive", effort: "medium" },
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    contextWindowTokens: 200_000,
    maxOutputTokens: 16_000,
    thinking: { kind: "budget", budgetTokens: 4_096 },
  },
} as const satisfies Record<string, AssistantModelProfile>;

export type AssistantModelId = keyof typeof ASSISTANT_MODELS;

/** The model the alpha answers with (ADR 0006 decision 2). */
export const ASSISTANT_MODEL_ID: AssistantModelId = "claude-sonnet-5";

/**
 * The smallest context window among the configured models. The resent history
 * is bounded to fit this one, not the active model's, so swapping to the
 * smaller model can never be the change that overflows a long conversation
 * (ADR 0006 decision 3).
 */
export const SMALLEST_CONTEXT_WINDOW_TOKENS = Math.min(
  ...Object.values(ASSISTANT_MODELS).map((model) => model.contextWindowTokens),
);

/**
 * The name of the Secret Manager secret that holds the provider's API key. It
 * is bound to the Cloud Function only, so the key never reaches a browser, a
 * log line or project state.
 */
export const ASSISTANT_API_KEY_SECRET = "ANTHROPIC_API_KEY";

/** The name the browser calls the gateway by (a callable Cloud Function). */
export const ASSISTANT_CALLABLE_NAME = "assistantTurn";

/**
 * Limits on one turn's provider calls.
 *
 * - `attemptTimeoutMs`: one provider call, first byte to last, before it is
 *   abandoned as a `timeout`. Not retried: a slow provider retried is a
 *   slower one.
 * - `maxAttempts`: provider calls per turn, the first included. Only a
 *   transient failure (rate limited, overloaded, a 5xx, the network, a broken
 *   stream) that has not yet streamed any text is retried.
 * - `retryBackoffMs`: the wait before the second attempt, doubled each time.
 * - `functionTimeoutSeconds`: the Cloud Function's own ceiling, which has to
 *   cover every attempt and its backoff.
 */
export interface AssistantCallLimits {
  readonly attemptTimeoutMs: number;
  readonly maxAttempts: number;
  readonly retryBackoffMs: number;
  readonly functionTimeoutSeconds: number;
}

export const ASSISTANT_CALL_LIMITS: AssistantCallLimits = {
  attemptTimeoutMs: 90_000,
  maxAttempts: 3,
  retryBackoffMs: 1_000,
  functionTimeoutSeconds: 300,
};

/**
 * Limits on what a browser may send in one turn, checked before anything
 * reaches the provider. The history bound below decides what is *resent*;
 * these just refuse a request no client of ours would build.
 */
export const ASSISTANT_REQUEST_LIMITS = {
  /** Messages in one request's conversation, the new one included. */
  maxMessages: 200,
  /** Characters in any one message. */
  maxMessageChars: 8_000,
} as const;

/**
 * Tokens are estimated, not counted: a count would cost a provider round
 * trip per turn. Three characters per token over-estimates English prose and
 * JSON alike, so the bound errs towards sending less, never more.
 */
export const ESTIMATED_CHARS_PER_TOKEN = 3;

/**
 * The most conversation history resent with one turn, in estimated tokens.
 * Well inside the smallest window ({@link SMALLEST_CONTEXT_WINDOW_TOKENS}),
 * because every resent token is paid for again on every turn; the per-turn
 * bound also subtracts the system prompt and project context, so a large
 * selection leaves less room for history rather than overflowing.
 */
export const ASSISTANT_HISTORY_TOKEN_BUDGET = 32_000;

/** Headroom left unused in the window, for the estimate being off. */
export const CONTEXT_WINDOW_MARGIN_TOKENS = 4_000;
