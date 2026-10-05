import { type AccessRepository, sortAllowlist, sortAttempts } from "./accessRepository";
import { type AllowlistEntry, normaliseEmail, type SignInAttempt } from "./allowlist";

/** The in-memory store, plus the refusal only the blocking function writes elsewhere. */
export interface InMemoryAccessRepository extends AccessRepository {
  recordAttempt(attempt: SignInAttempt): void;
}

/**
 * The allowlist in memory: the mock backend's store and the tests'. A fresh
 * one per page load, like every mock store.
 */
export function createInMemoryAccessRepository(
  seed: { allowlist?: AllowlistEntry[]; attempts?: SignInAttempt[] } = {},
): InMemoryAccessRepository {
  const allowlist = new Map((seed.allowlist ?? []).map((entry) => [entry.email, entry]));
  const attempts = new Map(
    (seed.attempts ?? []).map((attempt) => [attempt.email, attempt]),
  );
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
    recordAttempt(attempt) {
      attempts.set(attempt.email, attempt);
    },
  };
}
