/**
 * The assistant callable's handler (#69): Firebase's request and response on
 * one side, `runAssistantTurn` (`src/assistant/gateway.ts`) on the other.
 * Kept out of `index.ts` so it is tested without deploying anything; the
 * decisions all live in the gateway.
 */
import { logger } from "firebase-functions";
import {
  type CallableRequest,
  type CallableResponse,
  type FunctionsErrorCode,
  HttpsError,
} from "firebase-functions/v2/https";
import { type AssistantGatewayDeps, runAssistantTurn } from "../../src/assistant/gateway";
import {
  type AssistantErrorCode,
  AssistantGatewayError,
  type AssistantStreamChunk,
  type AssistantTurnResult,
} from "../../src/assistant/protocol";

/** How each gateway failure reaches the browser. */
const HTTPS_CODES: Record<AssistantErrorCode, FunctionsErrorCode> = {
  unauthenticated: "unauthenticated",
  invalid_request: "invalid-argument",
  timeout: "deadline-exceeded",
  cancelled: "cancelled",
  provider_unavailable: "unavailable",
  provider_error: "failed-precondition",
  malformed_response: "internal",
};

export function toHttpsError(error: AssistantGatewayError): HttpsError {
  return new HttpsError(HTTPS_CODES[error.code], error.message, error.details);
}

/** Everything but the provider is wired here; the provider needs the secret. */
export type AssistantHandlerDeps = Omit<AssistantGatewayDeps, "log" | "now"> &
  Partial<Pick<AssistantGatewayDeps, "log" | "now">>;

export function createAssistantHandler(
  deps: () => AssistantHandlerDeps,
): (
  request: CallableRequest<unknown>,
  response?: CallableResponse<AssistantStreamChunk>,
) => Promise<AssistantTurnResult> {
  return async (request, response) => {
    const token = request.auth?.token as
      | { firebase?: { sign_in_provider?: unknown } }
      | undefined;
    const signInProvider = token?.firebase?.sign_in_provider;
    try {
      return await runAssistantTurn(
        {
          log: (record) => logger.info("assistant turn", record),
          now: Date.now,
          ...deps(),
        },
        {
          uid: request.auth?.uid ?? null,
          signInProvider: typeof signInProvider === "string" ? signInProvider : null,
        },
        request.data,
        {
          signal: response?.signal ?? new AbortController().signal,
          onChunk: (chunk) => response?.sendChunk(chunk),
        },
      );
    } catch (error) {
      if (error instanceof AssistantGatewayError) throw toHttpsError(error);
      throw new HttpsError("internal", "The assistant failed.");
    }
  };
}
