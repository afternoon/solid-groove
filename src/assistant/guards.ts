/**
 * Where the assistant's limits are kept, and the boundary the gateway reads
 * them through (ADR 0006 decisions 5 and 6).
 *
 * Three top-level collections, written only by the Cloud Function with the
 * admin credential. `firestore.rules` denies every client, the owner of a
 * usage record included, so nobody can lower their own count or flip the
 * switch from a browser.
 *
 * - `assistantUsage/{uid}`: one account's recent calls ({@link AssistantUsageRecord}).
 * - `assistantSpend/{YYYY-MM-DD}`: one UTC day's spend ({@link AssistantSpendRecord}).
 * - `assistantControl/settings`: the manual kill switch, `{ enabled: boolean }`.
 *   Set `enabled` to `false` in the Firebase console to stop the assistant at
 *   once, with no deploy. A missing document means enabled.
 */
import type { AssistantUsageRecord, QuotaDecision } from "./quota";

export const ASSISTANT_USAGE_COLLECTION = "assistantUsage";
export const ASSISTANT_SPEND_COLLECTION = "assistantSpend";
export const ASSISTANT_CONTROL_DOC = "assistantControl/settings";

export function assistantUsageDocPath(uid: string): string {
  return `${ASSISTANT_USAGE_COLLECTION}/${uid}`;
}

export function assistantSpendDocPath(day: string): string {
  return `${ASSISTANT_SPEND_COLLECTION}/${day}`;
}

/** The kill switch document's shape. */
export interface AssistantControlRecord {
  readonly enabled: boolean;
}

/** Whether a kill switch document (or its absence) leaves the assistant on. */
export function assistantEnabled(record: unknown): boolean {
  if (record === null || record === undefined) return true;
  return (record as { enabled?: unknown }).enabled !== false;
}

export interface AssistantGuardStores {
  /** Whether the manual kill switch leaves the assistant on. */
  isEnabled(): Promise<boolean>;
  /**
   * Runs `admit` over the account's usage record and stores its `next`
   * record if it allowed the call. A read-modify-write, so the store runs it
   * in a transaction.
   */
  reserveCall(
    uid: string,
    admit: (record: AssistantUsageRecord | null) => QuotaDecision,
  ): Promise<QuotaDecision>;
  /** The day's spend so far, in micro-dollars. */
  spentMicroUsd(day: string): Promise<number>;
  /** Adds to the day's spend. Concurrent additions must all land. */
  addSpend(day: string, microUsd: number): Promise<void>;
}
