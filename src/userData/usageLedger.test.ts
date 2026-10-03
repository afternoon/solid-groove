import { describe, expect, it } from "vitest";
import {
  recordObjectDeleted,
  recordObjectWritten,
  type UsageTransaction,
} from "./usageLedger";
import type { UsageDocument, UsageLedgerEntry } from "./userData";

/** An in-memory stand-in for the Firestore transaction the function runs in. */
function memoryStore() {
  const entries = new Map<string, UsageLedgerEntry>();
  const usage = new Map<string, UsageDocument>();
  const tx: UsageTransaction = {
    getEntry: async (uid, path) => entries.get(`${uid}|${path}`) ?? null,
    getUsage: async (uid) => usage.get(uid) ?? null,
    setEntry: (uid, path, entry) => void entries.set(`${uid}|${path}`, entry),
    deleteEntry: (uid, path) => void entries.delete(`${uid}|${path}`),
    setUsage: (uid, doc) => void usage.set(uid, doc),
  };
  return { tx, entries, total: (uid: string) => usage.get(uid)?.totalBytes ?? 0, usage };
}

const PATH = "users/u1/packs/pak_a/ast_a";

describe("the usage ledger", () => {
  it("counts a written object against its owner and its kind", async () => {
    const store = memoryStore();
    const outcome = await recordObjectWritten(
      store.tx,
      { path: PATH, generation: "1", size: 500 },
      10,
    );
    expect(outcome).toEqual({ applied: true, uid: "u1", deltaBytes: 500 });
    expect(store.usage.get("u1")).toEqual({
      totalBytes: 500,
      byKind: { packs: 500 },
      updatedAt: 10,
    });
  });

  it("ignores a repeated delivery of the same write", async () => {
    const store = memoryStore();
    const event = { path: PATH, generation: "1", size: 500 };
    await recordObjectWritten(store.tx, event, 1);
    const again = await recordObjectWritten(store.tx, event, 2);
    expect(again).toEqual({ applied: false, reason: "duplicate" });
    expect(store.total("u1")).toBe(500);
  });

  it("releases a deleted object's bytes once", async () => {
    const store = memoryStore();
    await recordObjectWritten(store.tx, { path: PATH, generation: "1", size: 500 }, 1);
    await recordObjectWritten(
      store.tx,
      { path: "users/u1/packs/pak_a/ast_b", generation: "1", size: 200 },
      1,
    );
    await recordObjectDeleted(store.tx, { path: PATH, generation: "1" }, 2);
    expect(store.total("u1")).toBe(200);
    const again = await recordObjectDeleted(store.tx, { path: PATH, generation: "1" }, 3);
    expect(again).toEqual({ applied: false, reason: "duplicate" });
    expect(store.total("u1")).toBe(200);
  });

  it("balances an overwrite whose delete arrives after the new write", async () => {
    const store = memoryStore();
    await recordObjectWritten(store.tx, { path: PATH, generation: "1", size: 500 }, 1);
    await recordObjectWritten(store.tx, { path: PATH, generation: "2", size: 800 }, 2);
    expect(store.total("u1")).toBe(800);
    const late = await recordObjectDeleted(store.tx, { path: PATH, generation: "1" }, 3);
    expect(late).toEqual({ applied: false, reason: "stale" });
    expect(store.total("u1")).toBe(800);
  });

  it("balances an overwrite whose delete arrives first", async () => {
    const store = memoryStore();
    await recordObjectWritten(store.tx, { path: PATH, generation: "1", size: 500 }, 1);
    await recordObjectDeleted(store.tx, { path: PATH, generation: "1" }, 2);
    await recordObjectWritten(store.tx, { path: PATH, generation: "2", size: 800 }, 3);
    expect(store.total("u1")).toBe(800);
  });

  it("charges nobody for the factory library or an undeclared kind", async () => {
    const store = memoryStore();
    for (const path of ["library/audio/kick.ogg", "users/u1/secrets/a"]) {
      const outcome = await recordObjectWritten(
        store.tx,
        { path, generation: "1", size: 9 },
        1,
      );
      expect(outcome).toEqual({ applied: false, reason: "not_user_data" });
    }
    expect(store.usage.size).toBe(0);
  });

  it("keeps each user's total separate", async () => {
    const store = memoryStore();
    await recordObjectWritten(store.tx, { path: PATH, generation: "1", size: 5 }, 1);
    await recordObjectWritten(
      store.tx,
      { path: "users/u2/packs/pak_b/ast_b", generation: "1", size: 7 },
      1,
    );
    expect(store.total("u1")).toBe(5);
    expect(store.total("u2")).toBe(7);
  });
});
