import {
  parseUserDataPath,
  type UsageDocument,
  type UsageLedgerEntry,
  type UserDataKind,
} from "./userData";

/**
 * How a user's storage total moves when an object is written or deleted (#282).
 *
 * The Cloud Function in `functions/src/index.ts` is a thin wrapper that hands
 * Cloud Storage's `finalized` and `deleted` events to {@link recordObjectWritten}
 * and {@link recordObjectDeleted} inside a Firestore transaction. The rules are
 * all here, over a {@link UsageTransaction} interface, so they are unit-tested
 * without a function runtime or a database:
 *
 *  - an event is **idempotent**. Cloud Storage delivers at least once, so each
 *    object has a ledger entry recording the generation it counted, and a
 *    repeat changes nothing;
 *  - an **overwrite** is a delete of the old generation and a write of the new
 *    one, in either order. The ledger keys on the path and remembers the
 *    generation, so a late delete of a replaced generation is ignored rather
 *    than subtracting the new object's bytes;
 *  - only `users/{uid}/{kind}/…` objects of a declared kind count. The factory
 *    library and anything else in the bucket are skipped.
 */

/** The reads and writes one transaction needs. */
export interface UsageTransaction {
  getEntry(uid: string, objectPath: string): Promise<UsageLedgerEntry | null>;
  getUsage(uid: string): Promise<UsageDocument | null>;
  setEntry(uid: string, objectPath: string, entry: UsageLedgerEntry): void;
  deleteEntry(uid: string, objectPath: string): void;
  setUsage(uid: string, usage: UsageDocument): void;
}

/** One Cloud Storage object event, reduced to what the ledger reads. */
export interface StorageObjectEvent {
  readonly path: string;
  readonly generation: string;
  /** Bytes, for a write; ignored on delete. */
  readonly size?: number;
}

/** What one event did to the total, for the function's log line. */
export type LedgerOutcome =
  | { readonly applied: false; readonly reason: "not_user_data" | "duplicate" | "stale" }
  | { readonly applied: true; readonly uid: string; readonly deltaBytes: number };

const EMPTY_USAGE: UsageDocument = { totalBytes: 0, byKind: {}, updatedAt: 0 };

/** Count a written (or overwritten) object against its owner. */
export async function recordObjectWritten(
  tx: UsageTransaction,
  event: StorageObjectEvent,
  now: number,
): Promise<LedgerOutcome> {
  const owner = parseUserDataPath(event.path);
  if (!owner) return { applied: false, reason: "not_user_data" };
  const [entry, usage] = await Promise.all([
    tx.getEntry(owner.uid, event.path),
    tx.getUsage(owner.uid),
  ]);
  if (entry?.generation === event.generation) {
    return { applied: false, reason: "duplicate" };
  }
  const bytes = Math.max(0, Math.round(event.size ?? 0));
  // An overwrite whose delete has not arrived yet replaces the old entry here,
  // so the old generation's bytes come off once, now, and its delete is stale.
  const delta = bytes - (entry?.bytes ?? 0);
  tx.setEntry(owner.uid, event.path, {
    kind: owner.kind,
    bytes,
    generation: event.generation,
  });
  tx.setUsage(owner.uid, adjust(usage ?? EMPTY_USAGE, owner.kind, delta, now));
  return { applied: true, uid: owner.uid, deltaBytes: delta };
}

/** Release a deleted object's bytes, unless a newer generation already replaced it. */
export async function recordObjectDeleted(
  tx: UsageTransaction,
  event: StorageObjectEvent,
  now: number,
): Promise<LedgerOutcome> {
  const owner = parseUserDataPath(event.path);
  if (!owner) return { applied: false, reason: "not_user_data" };
  const [entry, usage] = await Promise.all([
    tx.getEntry(owner.uid, event.path),
    tx.getUsage(owner.uid),
  ]);
  if (!entry) return { applied: false, reason: "duplicate" };
  if (entry.generation !== event.generation) return { applied: false, reason: "stale" };
  tx.deleteEntry(owner.uid, event.path);
  tx.setUsage(owner.uid, adjust(usage ?? EMPTY_USAGE, owner.kind, -entry.bytes, now));
  return { applied: true, uid: owner.uid, deltaBytes: -entry.bytes };
}

/**
 * The usage document after `delta` bytes of `kind`. The kind is part of the
 * path the ledger is keyed on, so an object never changes kind, and the total
 * is always the sum of the kinds.
 */
function adjust(
  usage: UsageDocument,
  kind: UserDataKind,
  delta: number,
  now: number,
): UsageDocument {
  const byKind: Partial<Record<UserDataKind, number>> = {
    ...usage.byKind,
    [kind]: (usage.byKind[kind] ?? 0) + delta,
  };
  const totalBytes = Object.values(byKind).reduce((sum, bytes) => sum + (bytes ?? 0), 0);
  return { totalBytes, byKind, updatedAt: now };
}
