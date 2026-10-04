// The Firestore allowlist store (#854) against a real (local) Firestore
// instance, through the real security rules, as an admin-claim account. It
// runs the same contract suite as the in-memory store.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, type Firestore, setDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { describeAccessRepositoryContract } from "../../src/access/accessRepositoryContract";
import {
  approveEmails,
  parseEmailBatch,
  signInAttemptDocPath,
} from "../../src/access/allowlist";
import { FirestoreAccessRepository } from "../../src/access/firestoreAccessRepository";
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

describeAccessRepositoryContract("firestore", {
  repository: async () => {
    await testEnv.clearFirestore();
    return new FirestoreAccessRepository(adminFirestore());
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
    );
    await expect(repository.listAllowlist()).rejects.toThrow();
    await expect(
      approveEmails(repository, parseEmailBatch("me@example.com"), 1),
    ).rejects.toThrow();
  });
});
