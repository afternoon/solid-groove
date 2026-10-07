// The Firestore allowlist store (#854) against a real (local) Firestore
// instance, through the real security rules, as an admin-claim account. It
// runs the same contract suite as the in-memory store.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, type Firestore, getDoc, setDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { describeAccessRepositoryContract } from "../../src/access/accessRepositoryContract";
import {
  allowlistDocPath,
  approveEmails,
  parseEmailBatch,
  signInAttemptDocPath,
} from "../../src/access/allowlist";
import {
  FirestoreAccessRepository,
  type RevokeAccessCall,
} from "../../src/access/firestoreAccessRepository";
import { type RevokeAccessResult, revokeAccess } from "../../src/access/revokeAccess";
import { createTestEnvironment, emulatorProjectId, registeredContext } from "./setup";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnvironment(emulatorProjectId("access"));
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

function adminFirestore(): Firestore {
  return testEnv
    .authenticatedContext("admin-uid", {
      admin: true,
      firebase: { sign_in_provider: "google.com" },
    })
    .firestore() as unknown as Firestore;
}

/**
 * Addresses an account has "signed in" with, for the revocation stand-in: the
 * real callable asks Firebase Auth, which this suite does not run.
 */
const accounts = new Set<string>();

/**
 * The `revokeAccess` callable, stood in for: the same decision it runs, over
 * the admin credential (rules disabled), with {@link accounts} for Auth.
 */
const revokeAsFunction: RevokeAccessCall = async (email) => {
  let result: RevokeAccessResult | undefined;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await revokeAccess(
      {
        async unlist(target) {
          const ref = doc(context.firestore(), allowlistDocPath(target));
          if (!(await getDoc(ref)).exists()) return false;
          await deleteDoc(ref);
          return true;
        },
        async endSessions(target) {
          return accounts.has(target);
        },
      },
      { admin: true, email: null },
      { email },
    );
  });
  if (!result) throw new Error("The stand-in revocation returned nothing.");
  return result;
};

describeAccessRepositoryContract("firestore", {
  repository: async () => {
    await testEnv.clearFirestore();
    accounts.clear();
    return new FirestoreAccessRepository(adminFirestore(), revokeAsFunction);
  },
  seedAccount: async (_repository, email) => {
    accounts.add(email);
  },
  // The blocking function writes attempts with the admin credential.
  seedAttempt: async (_repository, attempt) =>
    testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), signInAttemptDocPath(attempt.email)),
        attempt,
      );
    }),
});

describe("FirestoreAccessRepository for a non-admin", () => {
  it("is refused by the rules, so the page cannot be used without the claim", async () => {
    const repository = new FirestoreAccessRepository(
      registeredContext(testEnv, "producer").firestore() as unknown as Firestore,
      revokeAsFunction,
    );
    await expect(repository.listAllowlist()).rejects.toThrow();
    await expect(
      approveEmails(repository, parseEmailBatch("me@example.com"), 1),
    ).rejects.toThrow();
  });
});
