import { describe, expect, it } from "vitest";
import type { AccessRepository } from "./accessRepository";
import { approveEmails, parseEmailBatch, type SignInAttempt } from "./allowlist";

/**
 * What every `AccessRepository` does (#854), run against the in-memory store
 * here and the Firestore store, through the real rules, in the emulator suite.
 */
export interface AccessRepositoryHarness {
  /** A fresh, empty store as an admin sees it. */
  repository(): Promise<AccessRepository>;
  /** Writes a refused sign-in the way the blocking function does. */
  seedAttempt(repository: AccessRepository, attempt: SignInAttempt): Promise<void>;
}

export function describeAccessRepositoryContract(
  name: string,
  harness: AccessRepositoryHarness,
): void {
  describe(`AccessRepository contract (${name})`, () => {
    it("approves a batch and lists it, most recently added first", async () => {
      const repository = await harness.repository();
      await approveEmails(repository, parseEmailBatch("ada@example.com"), 1);
      const report = await approveEmails(
        repository,
        parseEmailBatch("grace@example.com\nada@example.com"),
        2,
      );
      expect(report.added).toEqual(["grace@example.com"]);
      expect(report.alreadyListed).toEqual(["ada@example.com"]);
      expect(await repository.listAllowlist()).toEqual([
        { email: "grace@example.com", addedAt: 2 },
        { email: "ada@example.com", addedAt: 1 },
      ]);
    });

    it("clears an approved address's sign-in attempt and keeps the others", async () => {
      const repository = await harness.repository();
      await harness.seedAttempt(repository, {
        email: "grace@example.com",
        firstAttemptAt: 1,
        lastAttemptAt: 5,
        count: 2,
      });
      await harness.seedAttempt(repository, {
        email: "linus@example.com",
        firstAttemptAt: 3,
        lastAttemptAt: 3,
        count: 1,
      });
      expect((await repository.listAttempts()).map((a) => a.email)).toEqual([
        "grace@example.com",
        "linus@example.com",
      ]);
      await approveEmails(repository, parseEmailBatch("grace@example.com"), 9);
      expect(await repository.listAttempts()).toEqual([
        { email: "linus@example.com", firstAttemptAt: 3, lastAttemptAt: 3, count: 1 },
      ]);
    });

    it("removes an address, and removing one that is not there succeeds", async () => {
      const repository = await harness.repository();
      await approveEmails(repository, parseEmailBatch("ada@example.com"), 1);
      await repository.remove("ada@example.com");
      await repository.remove("nobody@example.com");
      expect(await repository.listAllowlist()).toEqual([]);
    });
  });
}
