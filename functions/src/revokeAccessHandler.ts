/**
 * The `revokeAccess` callable's handler (#1147): Firebase's request on one
 * side, `revokeAccess` (`src/access/revokeAccess.ts`) on the other. Kept out
 * of `index.ts` so it is tested without deploying anything; the decision,
 * the admin check included, lives in the shared module.
 */
import { logger } from "firebase-functions";
import {
  type CallableRequest,
  type FunctionsErrorCode,
  HttpsError,
} from "firebase-functions/v2/https";
import {
  type RevokeAccessRefusal,
  RevokeAccessRefused,
  type RevokeAccessResult,
  type RevokeAccessStore,
  revokeAccess,
} from "../../src/access/revokeAccess";
import { describeUnexpectedError } from "./assistantHandler";

/** How each refusal reaches the browser. */
const HTTPS_CODES: Record<RevokeAccessRefusal, FunctionsErrorCode> = {
  unauthenticated: "unauthenticated",
  not_admin: "permission-denied",
  invalid_request: "invalid-argument",
  self: "failed-precondition",
};

export function createRevokeAccessHandler(
  store: () => RevokeAccessStore,
): (request: CallableRequest<unknown>) => Promise<RevokeAccessResult> {
  return async (request) => {
    const token = request.auth?.token as { admin?: unknown; email?: unknown } | undefined;
    const caller = request.auth
      ? {
          admin: token?.admin === true,
          email: typeof token?.email === "string" ? token.email : null,
        }
      : null;
    try {
      const result = await revokeAccess(store(), caller, request.data);
      // Counts and flags only: nothing logged here names the address.
      logger.info("access revoked", {
        was_listed: result.wasListed,
        sessions_ended: result.sessionsEnded,
      });
      return result;
    } catch (error) {
      if (error instanceof RevokeAccessRefused) {
        logger.info("a revocation was refused", { reason: error.reason });
        throw new HttpsError(HTTPS_CODES[error.reason], error.message);
      }
      logger.error("revoking access failed unexpectedly", describeUnexpectedError(error));
      throw new HttpsError("internal", "Couldn't revoke access.");
    }
  };
}
