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
import {
  noteTriggerSchema,
  timeSignatureSchema,
  trackTypeSchema,
} from "../domain/entities";
import { MAX_SELECTED_NOTES } from "../projection/selectedNotes";
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
  volume: z.number().min(-60).max(6),
  pan: z.number().min(-1).max(1),
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

const unit = z.number().min(0).max(1);

/** One selected note, at its clip-relative position. */
export const assistantNoteEventSchema = z.strictObject({
  id: z.string().max(64),
  trigger: noteTriggerSchema,
  startTicks: ticks,
  durationTicks: ticks,
  velocity: unit,
  probability: unit.nullable(),
});

/**
 * The current selection's raw note events, and only the selection's
 * (ADR 0007 decision 3; `src/projection/selectedNotes.ts`). Never a clip's
 * name.
 */
export const assistantSelectedNotesSchema = z.strictObject({
  clips: z
    .array(
      z.strictObject({
        clipId: z.string().max(64),
        trackId: z.string().max(64),
        lengthTicks: ticks,
        events: z.array(assistantNoteEventSchema).max(MAX_SELECTED_NOTES),
      }),
    )
    .max(MAX_SELECTED_NOTES),
  noteCount: count.max(MAX_SELECTED_NOTES),
  omittedNoteCount: count,
});

const registerSchema = z.strictObject({
  lowestPitch: z.int().min(0).max(127),
  highestPitch: z.int().min(0).max(127),
  meanPitch: z.int().min(0).max(127),
  distinctPitchClasses: z.int().min(0).max(12),
});

/** Derived note statistics: register, velocity, density (ADR 0007 decision 1). */
export const assistantNoteStatsSchema = z.strictObject({
  noteCount: count,
  padNoteCount: count,
  register: registerSchema.nullable(),
  meanVelocity: unit.nullable(),
  notesPerBar: z.number().min(0).nullable(),
});

/** Per-track statistics, repetition included. */
export const assistantTrackNoteStatsSchema = assistantNoteStatsSchema.extend({
  trackId: z.string().max(64),
  repetitionRatio: unit,
  distinctClipCount: count,
});

/**
 * The project context sent with a turn: the open project's name, tempo,
 * time signature and length, its sections and tracks with their mixer
 * state, derived note statistics, a description of the selection, and the
 * selection's notes. ADR 0007's allowlist, field for field. Never the
 * project's ID, its owner, an asset, a URL, a clip's name or a note outside
 * the selection.
 */
export const assistantContextPayloadSchema = z.strictObject({
  projectName: name,
  tempo: z.number().min(1).max(999),
  timeSignature: timeSignatureSchema,
  totalTicks: ticks,
  tracks: z.array(assistantTrackContextSchema).max(256),
  sections: z.array(assistantSectionContextSchema).max(256),
  noteStats: z.strictObject({
    song: assistantNoteStatsSchema,
    tracks: z.array(assistantTrackNoteStatsSchema).max(256),
  }),
  selection: assistantSelectionContextSchema.nullable(),
  selectedNotes: assistantSelectedNotesSchema.nullable(),
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
  /** Provider calls the account has left in the rolling window. */
  readonly requestsRemaining: number;
}

/**
 * Every way a turn can fail, as a stable code the browser branches on and the
 * telemetry counts. Never a provider's own message, which can echo the
 * request back.
 *
 * - `unauthenticated`: no signed-in account, or a guest (ADR 0006 decision 4).
 * - `invalid_request`: the request did not parse, or its context cannot fit.
 * - `timeout`: the provider went quiet for longer than an attempt may.
 * - `cancelled`: the browser went away; the provider call was abandoned.
 * - `provider_unavailable`: rate limited, overloaded or down, after retries.
 * - `provider_error`: the provider refused the request itself (a 4xx), or
 *   ended the reply for a reason a text turn never has; retrying fixes
 *   neither.
 * - `malformed_response`: the provider's stream broke, or its reply failed
 *   validation.
 * - `quota_exceeded`: the account has made its 100 requests in the last 24
 *   hours; `resetsAt` says when the next one frees up (ADR 0006 decision 5).
 * - `assistant_disabled`: the manual kill switch is off.
 * - `spend_ceiling_reached`: today's organisation-wide spend ceiling is hit.
 */
export const ASSISTANT_ERROR_CODES = [
  "unauthenticated",
  "invalid_request",
  "timeout",
  "cancelled",
  "provider_unavailable",
  "provider_error",
  "malformed_response",
  "quota_exceeded",
  "assistant_disabled",
  "spend_ceiling_reached",
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
  /** For `quota_exceeded`: when the next request frees up, ms since the epoch. */
  readonly resetsAt?: number;
}

/** A turn that failed for a known reason. Its message is ours, never the provider's. */
export class AssistantGatewayError extends Error {
  readonly code: AssistantErrorCode;
  readonly resetsAt: number | undefined;

  constructor(code: AssistantErrorCode, message: string, resetsAt?: number) {
    super(message);
    this.name = "AssistantGatewayError";
    this.code = code;
    this.resetsAt = resetsAt;
  }

  get details(): AssistantErrorDetails {
    return {
      code: this.code,
      retryable: RETRYABLE_CODES.has(this.code),
      ...(this.resetsAt === undefined ? {} : { resetsAt: this.resetsAt }),
    };
  }
}
