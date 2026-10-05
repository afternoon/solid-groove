/**
 * The per-account request cap (ADR 0006 decision 5): 100 provider calls per
 * account in a rolling 24 hours, retries included.
 *
 * The record is the times of the account's recent calls. Rolling rather than
 * a calendar day, so it cannot be reset by waiting for midnight, and it says
 * exactly when the next call frees up. Pure: the store runs
 * {@link admitCall} inside a transaction, so two turns racing for the last
 * call cannot both get it.
 */
import { ASSISTANT_LIMITS } from "./config";

/** One account's recent provider calls: `assistantUsage/{uid}`. */
export interface AssistantUsageRecord {
  readonly schemaVersion: 1;
  /** When each call in the window was made, in ms since the epoch, oldest first. */
  readonly calls: readonly number[];
}

export interface QuotaLimits {
  readonly requestsPerWindow: number;
  readonly windowMs: number;
}

export type QuotaDecision =
  | {
      readonly allowed: true;
      /** The record with this call added and expired calls pruned. */
      readonly next: AssistantUsageRecord;
      /** Calls left in the window after this one. */
      readonly remaining: number;
    }
  | {
      readonly allowed: false;
      /** When the oldest counted call leaves the window, in ms since the epoch. */
      readonly resetsAt: number;
    };

/** Whether one more provider call may be made at `now`, and the record after it. */
export function admitCall(
  record: AssistantUsageRecord | null,
  now: number,
  limits: QuotaLimits = ASSISTANT_LIMITS,
): QuotaDecision {
  const windowStart = now - limits.windowMs;
  const recent = (record?.calls ?? []).filter((at) => at > windowStart && at <= now);
  if (recent.length >= limits.requestsPerWindow) {
    const freedBy = recent[recent.length - limits.requestsPerWindow];
    return { allowed: false, resetsAt: freedBy + limits.windowMs };
  }
  return {
    allowed: true,
    next: { schemaVersion: 1, calls: [...recent, now] },
    remaining: limits.requestsPerWindow - recent.length - 1,
  };
}

/** The account's request cap has been reached; `resetsAt` is in ms since the epoch. */
export function quotaExceededMessage(
  resetsAt: number,
  limit: number = ASSISTANT_LIMITS.requestsPerWindow,
): string {
  const when = new Date(resetsAt).toISOString().slice(0, 16).replace("T", " ");
  return `You've used all ${limit} assistant requests for the last 24 hours. The next one frees up at ${when} UTC.`;
}
