/**
 * Revoking an account's access (#1147), decided once and tested here.
 *
 * Taking an address off the allowlist only refuses its *next* sign-in: the
 * blocking `beforeSignIn` function does not run when a session refreshes its
 * ID token, so whoever is signed in stays signed in. Revoking does both: the
 * address comes off the list, and the account's refresh tokens are revoked,
 * so every session it has ends as soon as its ID token expires (within the
 * hour). The next sign-in is refused by the gate and recorded as a blocked
 * attempt, so the address can be approved again in one click. The account is
 * neither disabled nor deleted, and nothing of theirs is touched.
 *
 * Only the Admin SDK can revoke tokens, so this runs in the `revokeAccess`
 * callable (`functions/src/index.ts`), which supplies the store and the
 * caller; the admin page calls it through `AccessRepository.revoke`. This
 * module imports nothing, so the function bundle, the page and the tests
 * share one decision.
 */
import { isValidEmail, normaliseEmail } from "./allowlist";

/** The callable's name, as deployed and as the browser calls it. */
export const REVOKE_ACCESS_CALLABLE = "revokeAccess";

/** What the callable is sent. */
export interface RevokeAccessRequest {
  email: string;
}

/** What a revocation did, for the page to report. */
export interface RevokeAccessResult {
  /** Normalised. */
  email: string;
  /** Whether the address was on the list when it was taken off. */
  wasListed: boolean;
  /** Whether an account has that address, and its sessions were ended. */
  sessionsEnded: boolean;
}

/** What the decision reads and writes, over the Admin SDK in the function. */
export interface RevokeAccessStore {
  /** Takes the address off the allowlist; whether it was on it. */
  unlist(email: string): Promise<boolean>;
  /**
   * Revokes the refresh tokens of the account with this address, so its
   * sessions end at their next token refresh; `false` when no account has it.
   */
  endSessions(email: string): Promise<boolean>;
}

/** Who is asking, as the function reads it off the caller's ID token. */
export interface RevokeAccessCaller {
  /** The `admin: true` custom claim. */
  admin: boolean;
  /** The caller's own address, to stop them locking themselves out. */
  email: string | null;
}

export type RevokeAccessRefusal =
  | "unauthenticated"
  | "not_admin"
  | "invalid_request"
  | "self";

/** A revocation that was refused before anything was written. */
export class RevokeAccessRefused extends Error {
  constructor(readonly reason: RevokeAccessRefusal) {
    super(REFUSAL_MESSAGES[reason]);
    this.name = "RevokeAccessRefused";
  }
}

const REFUSAL_MESSAGES: Record<RevokeAccessRefusal, string> = {
  unauthenticated: "Sign in to revoke access.",
  not_admin: "Only an admin can revoke access.",
  invalid_request: "Revoking access needs one email address.",
  self: "An admin cannot revoke their own access.",
};

/** The address a request names, normalised, or `null` when it is not one. */
export function parseRevokeAccessRequest(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as { email?: unknown }).email;
  if (typeof raw !== "string") return null;
  const email = normaliseEmail(raw);
  return isValidEmail(email) ? email : null;
}

/**
 * Revokes one address's access for an admin caller, or refuses with a
 * {@link RevokeAccessRefused} before writing anything.
 *
 * The list is written first, then the sessions: an address off the list with
 * a session still running is the state Remove already leaves, and a retry
 * repeats both steps harmlessly, so a failure between the two needs no
 * special report. The sessions are ended whether or not the address was
 * still listed, so revoking someone removed earlier still signs them out.
 */
export async function revokeAccess(
  store: RevokeAccessStore,
  caller: RevokeAccessCaller | null,
  input: unknown,
): Promise<RevokeAccessResult> {
  if (!caller) throw new RevokeAccessRefused("unauthenticated");
  if (!caller.admin) throw new RevokeAccessRefused("not_admin");
  const email = parseRevokeAccessRequest(input);
  if (!email) throw new RevokeAccessRefused("invalid_request");
  if (caller.email !== null && normaliseEmail(caller.email) === email) {
    throw new RevokeAccessRefused("self");
  }
  const wasListed = await store.unlist(email);
  const sessionsEnded = await store.endSessions(email);
  return { email, wasListed, sessionsEnded };
}
