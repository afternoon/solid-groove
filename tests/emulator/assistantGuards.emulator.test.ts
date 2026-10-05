// The assistant's limits (#69, ADR 0006) against a real (local) Firestore.
//
// Two halves. The rules: no client reaches `assistantUsage`, `assistantSpend`
// or `assistantControl`, the account a usage record belongs to and an admin
// included. And the gateway itself, with a scripted provider, over the
// Firestore store the Cloud Function uses (`functions/src/assistantStores.ts`)
// through the admin SDK, running the same contract suite as the in-memory
// store: auth, quota, retries counted, timeout, malformed stream,
// cancellation, provider error, redacted telemetry, the kill switch and the
// spend ceiling, with real transactions under racing turns.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { firestoreGuardStores } from "../../functions/src/assistantStores";
import { describeGuardStoresContract } from "../../src/assistant/guardStoresContract";
import {
  ASSISTANT_CONTROL_DOC,
  assistantSpendDocPath,
  assistantUsageDocPath,
} from "../../src/assistant/guards";
import {
  assertFails,
  createTestEnvironment,
  emulatorProjectId,
  registeredContext,
} from "./setup";

const PROJECT_ID = emulatorProjectId("assistant");

let testEnv: RulesTestEnvironment;
const adminApp = initializeApp({ projectId: PROJECT_ID }, "assistant-guards");
const db = getFirestore(adminApp);

beforeAll(async () => {
  testEnv = await createTestEnvironment(PROJECT_ID);
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
  await deleteApp(adminApp);
});

describe("assistant limits rules", () => {
  const OWNER = "producer-uid";
  const PATHS = [
    assistantUsageDocPath(OWNER),
    assistantSpendDocPath("2026-10-05"),
    ASSISTANT_CONTROL_DOC,
  ];

  async function seed() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, assistantUsageDocPath(OWNER)), {
        schemaVersion: 1,
        calls: [1],
      });
      await setDoc(doc(firestore, assistantSpendDocPath("2026-10-05")), {
        schemaVersion: 1,
        day: "2026-10-05",
        microUsd: 10,
      });
      await setDoc(doc(firestore, ASSISTANT_CONTROL_DOC), { enabled: true });
    });
  }

  for (const path of PATHS) {
    it(`denies every client reading or writing ${path}`, async () => {
      await seed();
      const contexts = [
        registeredContext(testEnv, OWNER),
        testEnv.authenticatedContext("admin-uid", {
          admin: true,
          firebase: { sign_in_provider: "google.com" },
        }),
        testEnv.unauthenticatedContext(),
      ];
      for (const context of contexts) {
        const ref = doc(context.firestore(), path);
        await assertFails(getDoc(ref));
        await assertFails(setDoc(ref, { enabled: false, calls: [], microUsd: 0 }));
      }
    });
  }
});

async function clearAssistantCollections() {
  for (const name of ["assistantUsage", "assistantSpend", "assistantControl"]) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
}

describeGuardStoresContract("firestore", {
  stores: async () => {
    await clearAssistantCollections();
    return firestoreGuardStores(db);
  },
  setEnabled: async (enabled) => {
    await db.doc(ASSISTANT_CONTROL_DOC).set({ enabled });
  },
});
