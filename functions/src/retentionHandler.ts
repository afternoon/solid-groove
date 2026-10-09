/**
 * The `assistantRetention` callable's handler (GRV-8): Firebase's request on
 * one side, `handleRetentionRequest` (`src/assistant/retention.ts`) on the
 * other. Kept out of `index.ts` so it is tested without deploying anything;
 * every decision lives in the shared module.
 */
import { logger } from "firebase-functions";
import {
  type CallableRequest,
  type FunctionsErrorCode,
  HttpsError,
} from "firebase-functions/v2/https";
import {
  handleRetentionRequest,
  type RetentionErrorCode,
  RetentionRequestError,
  type RetentionResponse,
} from "../../src/assistant/retention";
import type { TranscriptStore } from "../../src/assistant/transcripts";
import { describeUnexpectedError } from "./assistantHandler";

const HTTPS_CODES: Record<RetentionErrorCode, FunctionsErrorCode> = {
  unauthenticated: "unauthenticated",
  invalid_request: "invalid-argument",
  stale_disclosure: "failed-precondition",
};

export function createRetentionHandler(
  store: () => TranscriptStore,
  now: () => number = Date.now,
): (request: CallableRequest<unknown>) => Promise<RetentionResponse> {
  return async (request) => {
    try {
      return await handleRetentionRequest(
        store(),
        request.auth?.uid ?? null,
        request.data,
        now(),
      );
    } catch (error) {
      if (error instanceof RetentionRequestError) {
        throw new HttpsError(HTTPS_CODES[error.code], error.message, {
          code: error.code,
        });
      }
      logger.error(
        "assistant retention failed unexpectedly",
        describeUnexpectedError(error),
      );
      throw new HttpsError("internal", "Couldn't update the assistant setting.");
    }
  };
}
