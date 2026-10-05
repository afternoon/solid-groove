/**
 * What the browser and the assistant gateway say to each other (#69).
 *
 * The request is parsed here, on the server, before anything reaches the
 * provider. Its project context is a **strict** schema: a field ADR 0007's
 * allowlist does not name is refused rather than passed through, so the
 * gateway enforces the allowlist even against a client that builds the
 * payload wrongly.
 *
 * Firebase-free and provider-free, so the browser can share these types.
 */
import { z } from "zod";
import { timeSignatureSchema, trackTypeSchema } from "../domain/entities";
import { ASSISTANT_REQUEST_LIMITS } from "./config";

const name = z.string().max(200);
const count = z.int().min(0);
const ticks = z.int().min(0);

/** One track, as the assistant sees it (ADR 0007 decision 1). */
export const assistantTrackContextSchema = z.strictObject({
  id: z.string().max(64),
  name,
  type: trackTypeSchema,
  instrumentKind: z.enum(["sampler", "synth", "drumMachine"]).nullable(),
  deviceCount: count,
  muted: z.boolean(),
  soloed: z.boolean(),
  clipCount: count,
  placementCount: count,
});

export const assistantSectionContextSchema = z.strictObject({
  id: z.string().max(64),
  name,
  startTicks: ticks,
  durationTicks: ticks,
});

export const assistantSelectionContextSchema = z.strictObject({
  description: z.string().max(200),
  countByKind: z.record(z.string().max(32), count),
});

/**
 * The project context sent with a turn: the open project's name, tempo,
 * time signature and length, its sections and tracks, and a description of
 * the selection. Never the project's ID, its owner, an asset or a URL.
 */
export const assistantContextPayloadSchema = z.strictObject({
  projectName: name,
  tempo: z.number().min(1).max(999),
  timeSignature: timeSignatureSchema,
  totalTicks: ticks,
  tracks: z.array(assistantTrackContextSchema).max(256),
  sections: z.array(assistantSectionContextSchema).max(256),
  selection: assistantSelectionContextSchema.nullable(),
});
export type AssistantContextPayload = z.infer<typeof assistantContextPayloadSchema>;

export const assistantMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(ASSISTANT_REQUEST_LIMITS.maxMessageChars),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/**
 * One turn: the conversation so far, ending in the user's new message, and
 * the project context it is about.
 */
export const assistantTurnRequestSchema = z.strictObject({
  messages: z
    .array(assistantMessageSchema)
    .min(1)
    .max(ASSISTANT_REQUEST_LIMITS.maxMessages)
    .refine((messages) => messages[messages.length - 1]?.role === "user", {
      message: "the conversation must end with the user's message",
    }),
  context: assistantContextPayloadSchema,
});
export type AssistantTurnRequest = z.infer<typeof assistantTurnRequestSchema>;

/** A chunk streamed to the browser while the reply is written. */
export interface AssistantStreamChunk {
  readonly type: "text";
  readonly text: string;
}

/** Why the provider stopped, as the browser needs to know it. */
export type AssistantStopReason = "end_turn" | "max_tokens" | "refusal";

/** What a completed turn returns. */
export interface AssistantTurnResult {
  /** The whole reply, the concatenation of every streamed chunk. */
  readonly text: string;
  readonly stopReason: AssistantStopReason;
  readonly model: string;
  readonly promptVersion: string;
}

/**
 * Every way a turn can fail, as a stable code the browser branches on and the
 * telemetry counts. Never a provider's own message, which can echo the
 * request back.
 *
 * - `unauthenticated`: no signed-in account, or a guest (ADR 0006 decision 4).
 * - `invalid_request`: the request did not parse, or its context cannot fit.
 * - `timeout`: the provider took longer than one attempt may.
 * - `cancelled`: the browser went away; the provider call was abandoned.
 * - `provider_unavailable`: rate limited, overloaded or down, after retries.
 * - `provider_error`: the provider refused the request itself (a 4xx), which
 *   retrying cannot fix.
 * - `malformed_response`: the provider's stream broke, or its reply failed
 *   validation.
 */
export const ASSISTANT_ERROR_CODES = [
  "unauthenticated",
  "invalid_request",
  "timeout",
  "cancelled",
  "provider_unavailable",
  "provider_error",
  "malformed_response",
] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

/** Codes the browser may offer to retry. */
const RETRYABLE_CODES: ReadonlySet<AssistantErrorCode> = new Set([
  "timeout",
  "provider_unavailable",
  "malformed_response",
]);

/** Extra, code-specific facts the browser needs to explain a failure. */
export interface AssistantErrorDetails {
  readonly code: AssistantErrorCode;
  readonly retryable: boolean;
}

/** A turn that failed for a known reason. Its message is ours, never the provider's. */
export class AssistantGatewayError extends Error {
  readonly code: AssistantErrorCode;

  constructor(code: AssistantErrorCode, message: string) {
    super(message);
    this.name = "AssistantGatewayError";
    this.code = code;
  }

  get details(): AssistantErrorDetails {
    return { code: this.code, retryable: RETRYABLE_CODES.has(this.code) };
  }
}
