import type { AllowlistEntry, AllowlistWriter, SignInAttempt } from "./allowlist";
import type { RevokeAccessResult } from "./revokeAccess";

/**
 * The admin page's boundary onto the alpha allowlist (#854).
 *
 * Only an account with the `admin: true` claim gets past `firestore.rules`
 * here, so every method may reject for anyone else; the page is never shown
 * to them in the first place. Like the other repositories it has an in-memory
 * store (mock backend and tests) and a Firestore one, and only the Firestore
 * one imports `firebase/firestore`.
 */
export interface AccessRepository extends AllowlistWriter {
  /** Every allowlisted address, most recently added first. */
  listAllowlist(): Promise<AllowlistEntry[]>;
  /** Every refused sign-in, most recent first. */
  listAttempts(): Promise<SignInAttempt[]>;
  /** Takes an address off the list. Removing one that is not there succeeds. */
  remove(email: string): Promise<void>;
  /**
   * Takes an address off the list *and* ends its account's sessions (#1147),
   * through the `revokeAccess` callable: see `src/access/revokeAccess.ts`.
   */
  revoke(email: string): Promise<RevokeAccessResult>;
}

export function sortAllowlist(entries: AllowlistEntry[]): AllowlistEntry[] {
  return [...entries].sort(
    (a, b) => b.addedAt - a.addedAt || a.email.localeCompare(b.email),
  );
}

export function sortAttempts(attempts: SignInAttempt[]): SignInAttempt[] {
  return [...attempts].sort(
    (a, b) => b.lastAttemptAt - a.lastAttemptAt || a.email.localeCompare(b.email),
  );
}
