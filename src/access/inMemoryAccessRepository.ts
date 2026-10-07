import { type AccessRepository, sortAllowlist, sortAttempts } from "./accessRepository";
import { type AllowlistEntry, normaliseEmail, type SignInAttempt } from "./allowlist";
import { revokeAccess } from "./revokeAccess";

/**
 * The in-memory store, plus what only the blocking function and Firebase Auth
 * write elsewhere: a refusal, and an account that has signed in.
 */
export interface InMemoryAccessRepository extends AccessRepository {
  recordAttempt(attempt: SignInAttempt): void;
  /** Stands in for an account signing in with the address. */
  recordAccount(email: string): void;
}

/**
 * The allowlist in memory: the mock backend's store and the tests'. A fresh
 * one per page load, like every mock store. A revocation runs the same
 * decision the callable does, over these maps, as an admin.
 */
export function createInMemoryAccessRepository(
  seed: {
    allowlist?: AllowlistEntry[];
    attempts?: SignInAttempt[];
    /** Addresses an account has signed in with. */
    accounts?: string[];
  } = {},
): InMemoryAccessRepository {
  const allowlist = new Map((seed.allowlist ?? []).map((entry) => [entry.email, entry]));
  const attempts = new Map(
    (seed.attempts ?? []).map((attempt) => [attempt.email, attempt]),
  );
  const accounts = new Set((seed.accounts ?? []).map(normaliseEmail));
  return {
    async listAllowlist() {
      return sortAllowlist([...allowlist.values()]);
    },
    async listAttempts() {
      return sortAttempts([...attempts.values()]);
    },
    async listed(emails) {
      return new Set(emails.filter((email) => allowlist.has(email)));
    },
    async commit(entries, clearAttempts) {
      for (const entry of entries) allowlist.set(entry.email, entry);
      for (const email of clearAttempts) attempts.delete(email);
    },
    async remove(email) {
      allowlist.delete(normaliseEmail(email));
    },
    revoke(email) {
      return revokeAccess(
        {
          async unlist(target) {
            return allowlist.delete(target);
          },
          async endSessions(target) {
            return accounts.has(target);
          },
        },
        { admin: true, email: null },
        { email },
      );
    },
    recordAttempt(attempt) {
      attempts.set(attempt.email, attempt);
    },
    recordAccount(email) {
      accounts.add(normaliseEmail(email));
    },
  };
}
