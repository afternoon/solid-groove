/**
 * The browser's one door to the assistant gateway (GRV-26).
 *
 * Nothing above this module knows that the gateway is a Cloud Function, that
 * the reply arrives as a stream of callable chunks, or that a provider exists
 * at all. A component sends an {@link AssistantTurnRequest} and receives a
 * typed sequence of {@link AssistantStreamEvent}s: `text`, then at most one
 * `proposal`, then at most one `ask`, then exactly one terminal `done` or
 * `error`.
 *
 * Like the rest of `src/assistant`, this is Firebase-free and SDK-free: the
 * transport is injected ({@link AssistantTurnTransport}). The app's is the
 * `assistantTurn` callable (`src/firebaseAssistantTransport.ts`), the mock
 * backend runs the gateway in the page (`localTransport.ts`), and component
 * tests pass a fake client instead of this one.
 *
 * **The wire is not trusted.** Chunks and the final result are parsed here
 * before any of them reaches a component, so a gateway (or an emulator, or a
 * proxy) answering with something else becomes a `malformed_response` error
 * rather than an undefined read in the panel. A failure's own code is read
 * from the callable error's `details`, and whether it may be retried is
 * derived from that code by {@link AssistantGatewayError}, never taken from
 * the wire.
 */
import { z } from "zod";
import { type AssistantAsk, parseAssistantAsk } from "./ask";
import {
  ASSISTANT_ERROR_CODES,
  type AssistantErrorCode,
  type AssistantErrorDetails,
  AssistantGatewayError,
  type AssistantProposal,
  type AssistantStopReason,
  type AssistantTurnRequest,
} from "./protocol";

/** What one turn tells the browser, in order. */
export type AssistantStreamEvent =
  /** A piece of the reply, as it is written. */
  | { readonly type: "text"; readonly text: string }
  /** The changes the turn proposes, once it is complete. */
  | { readonly type: "proposal"; readonly proposal: AssistantProposal }
  /** A question for the producer (GRV-42), once the turn is complete. */
  | { readonly type: "ask"; readonly ask: AssistantAsk }
  /** The turn failed. Terminal: no `done` follows. */
  | { readonly type: "error"; readonly error: AssistantErrorDetails }
  /** The turn is over. Terminal. */
  | {
      readonly type: "done";
      /** Whether the browser stopped it rather than the reply finishing. */
      readonly stopped: boolean;
      /** Why the provider stopped; `null` when the browser stopped the turn. */
      readonly stopReason: AssistantStopReason | null;
      /** Provider calls left in the account's window; `null` when stopped. */
      readonly requestsRemaining: number | null;
    };

/** One turn in flight. */
export interface AssistantTurnHandle {
  /**
   * Cancels the turn at the gateway. The connection is dropped, which aborts
   * the provider call, and a `done` with `stopped: true` is emitted at once,
   * so Stop is immediate rather than waiting on the network.
   */
  stop(): void;
}

export interface AssistantClient {
  /**
   * Starts one turn. Events arrive on `onEvent` until a terminal one; the
   * handle stops it early.
   */
  send(
    request: AssistantTurnRequest,
    onEvent: (event: AssistantStreamEvent) => void,
  ): AssistantTurnHandle;
}

/** The raw stream of one gateway call, as a transport returns it. */
export interface AssistantTurnStream {
  /** The reply's chunks, unvalidated. */
  readonly chunks: AsyncIterable<unknown>;
  /** The completed turn, unvalidated. Rejects as the gateway failed. */
  readonly result: Promise<unknown>;
}

/**
 * How a turn reaches the gateway. Aborting `signal` must drop the call. A
 * failure rejects with the callable error's shape: a `functions/<code>`
 * `code`, and the gateway's {@link AssistantErrorDetails} as `details`.
 */
export type AssistantTurnTransport = (
  request: AssistantTurnRequest,
  options: { readonly signal: AbortSignal },
) => Promise<AssistantTurnStream>;

const chunkSchema = z.looseObject({ type: z.literal("text"), text: z.string() });

const proposalSchema = z.looseObject({
  baseRevision: z.int().min(0),
  toolsetVersion: z.int().min(0),
  calls: z
    .array(z.looseObject({ id: z.string(), name: z.string(), input: z.unknown() }))
    .min(1),
});

const resultSchema = z.looseObject({
  text: z.string(),
  stopReason: z.enum(["end_turn", "max_tokens", "refusal", "tool_use"]),
  proposal: proposalSchema.nullish(),
  ask: z.unknown().nullish(),
  requestsRemaining: z.number().min(0).nullish(),
});

/**
 * How a callable error code maps onto a gateway code, for the rare answer
 * that carries no usable `details`: a proxy's 503, a dropped connection, or
 * a Firebase-level failure that never reached the gateway. `internal` is the
 * handler's own unexpected failure (`functions/src/assistantHandler.ts`),
 * which says nothing about whether asking again would work, so it is offered
 * as the transient failure it most likely was. So is a code nobody
 * recognises: that is the one guess that offers Try again.
 */
const CODES_BY_CALLABLE: Readonly<Record<string, AssistantErrorCode>> = {
  "functions/unauthenticated": "unauthenticated",
  "functions/permission-denied": "unauthenticated",
  "functions/invalid-argument": "invalid_request",
  "functions/deadline-exceeded": "timeout",
  "functions/cancelled": "cancelled",
  "functions/resource-exhausted": "quota_exceeded",
  "functions/failed-precondition": "provider_error",
  "functions/unavailable": "provider_unavailable",
  "functions/internal": "provider_unavailable",
};

const detailsSchema = z.looseObject({
  code: z.enum(ASSISTANT_ERROR_CODES),
  resetsAt: z.number().min(0).nullish(),
});

/** Details for `code`, with `retryable` derived from the code itself. */
export function assistantErrorDetails(
  code: AssistantErrorCode,
  resetsAt?: number,
): AssistantErrorDetails {
  return new AssistantGatewayError(code, code, resetsAt).details;
}

/**
 * What a thrown gateway failure means, in the browser's own terms. The
 * gateway sends its code and `resetsAt` in the callable error's `details`;
 * anything else is read from the callable code, and failing that treated as
 * a transient provider failure.
 */
export function assistantErrorFrom(error: unknown): AssistantErrorDetails {
  const raw = error as { code?: unknown; details?: unknown } | null | undefined;
  const details = detailsSchema.safeParse(raw?.details);
  if (details.success) {
    return assistantErrorDetails(details.data.code, details.data.resetsAt ?? undefined);
  }
  const callable = typeof raw?.code === "string" ? raw.code : "";
  return assistantErrorDetails(CODES_BY_CALLABLE[callable] ?? "provider_unavailable");
}

/**
 * The client over one transport. Stateless: every call to `send` is its own
 * turn, and the conversation itself is held above this layer.
 */
export function createAssistantClient(
  transport: AssistantTurnTransport,
): AssistantClient {
  return {
    send(request, onEvent) {
      const controller = new AbortController();
      let settled = false;

      /** Terminal events close the turn, so nothing can be emitted after one. */
      const emit = (event: AssistantStreamEvent): void => {
        if (settled) return;
        if (event.type === "done" || event.type === "error") settled = true;
        onEvent(event);
      };
      const malformed = () =>
        emit({ type: "error", error: assistantErrorDetails("malformed_response") });

      void (async () => {
        try {
          const stream = await transport(request, { signal: controller.signal });
          // Claim the result's rejection now: the loop below can throw first,
          // and an unclaimed rejected promise is an unhandled rejection.
          const result = stream.result;
          result.catch(() => undefined);
          for await (const chunk of stream.chunks) {
            if (settled) return;
            const parsed = chunkSchema.safeParse(chunk);
            if (!parsed.success) return malformed();
            emit({ type: "text", text: parsed.data.text });
          }
          const raw = await result;
          if (settled) return;
          const turn = resultSchema.safeParse(raw);
          if (!turn.success) return malformed();
          const ask = turn.data.ask == null ? null : parseAssistantAsk(turn.data.ask);
          if (turn.data.ask != null && !ask) return malformed();
          if (turn.data.proposal) {
            emit({ type: "proposal", proposal: turn.data.proposal as AssistantProposal });
          }
          if (ask) emit({ type: "ask", ask });
          emit({
            type: "done",
            stopped: false,
            stopReason: turn.data.stopReason,
            requestsRemaining: turn.data.requestsRemaining ?? null,
          });
        } catch (error) {
          // `stop()` has already reported the turn; the transport throwing
          // because its connection was dropped is that, not a failure.
          if (settled) return;
          emit({ type: "error", error: assistantErrorFrom(error) });
        }
      })();

      return {
        stop() {
          if (settled) return;
          emit({
            type: "done",
            stopped: true,
            stopReason: null,
            requestsRemaining: null,
          });
          controller.abort();
        },
      };
    },
  };
}
