/**
 * The assistant's limits over Firestore, with the admin credential (#69).
 * `src/assistant/guards.ts` owns the paths and the shapes; this only connects
 * them to documents. Runs the same contract suite as the in-memory store,
 * against the emulator (`tests/emulator/assistantGuards.emulator.test.ts`).
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  ASSISTANT_CONTROL_DOC,
  type AssistantGuardStores,
  assistantEnabled,
  assistantSpendDocPath,
  assistantUsageDocPath,
} from "../../src/assistant/guards";
import type { AssistantUsageRecord } from "../../src/assistant/quota";

export function firestoreGuardStores(db: Firestore): AssistantGuardStores {
  return {
    async isEnabled() {
      const snapshot = await db.doc(ASSISTANT_CONTROL_DOC).get();
      return assistantEnabled(snapshot.exists ? snapshot.data() : null);
    },
    reserveCall(uid, admit) {
      const ref = db.doc(assistantUsageDocPath(uid));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const decision = admit(
          snapshot.exists ? (snapshot.data() as AssistantUsageRecord) : null,
        );
        if (decision.allowed) tx.set(ref, decision.next);
        return decision;
      });
    },
    async spentMicroUsd(day) {
      const snapshot = await db.doc(assistantSpendDocPath(day)).get();
      const micro = snapshot.exists ? snapshot.get("microUsd") : 0;
      return typeof micro === "number" ? micro : 0;
    },
    async addSpend(day, microUsd) {
      await db
        .doc(assistantSpendDocPath(day))
        .set(
          { schemaVersion: 1, day, microUsd: FieldValue.increment(microUsd) },
          { merge: true },
        );
    },
  };
}
