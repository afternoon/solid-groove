/**
 * {@link AssistantGuardStores} in memory, for unit tests. Satisfies the same
 * contract suite (`guardStoresContract.ts`) as the Firestore store the Cloud
 * Function uses (`functions/src/assistantStores.ts`).
 */
import type { AssistantGuardStores } from "./guards";
import type { AssistantUsageRecord } from "./quota";

export interface InMemoryGuardStores extends AssistantGuardStores {
  setEnabled(enabled: boolean): void;
  usage(uid: string): AssistantUsageRecord | null;
}

export function createInMemoryGuardStores(): InMemoryGuardStores {
  let enabled = true;
  const usage = new Map<string, AssistantUsageRecord>();
  const spend = new Map<string, number>();
  // Serialises reservations the way a transaction would.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    setEnabled(next) {
      enabled = next;
    },
    usage(uid) {
      return usage.get(uid) ?? null;
    },
    async isEnabled() {
      return enabled;
    },
    reserveCall(uid, admit) {
      const run = queue.then(() => {
        const decision = admit(usage.get(uid) ?? null);
        if (decision.allowed) usage.set(uid, decision.next);
        return decision;
      });
      queue = run.catch(() => {});
      return run;
    },
    async spentMicroUsd(day) {
      return spend.get(day) ?? 0;
    },
    async addSpend(day, microUsd) {
      spend.set(day, (spend.get(day) ?? 0) + microUsd);
    },
  };
}
