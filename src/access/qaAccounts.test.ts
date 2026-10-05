import { describe, expect, it } from "vitest";
import { createInMemoryAccessRepository } from "./inMemoryAccessRepository";
import {
  isQaSlot,
  MAX_QA_SLOT,
  provisionQaAccounts,
  QA_ACCOUNTS,
  type QaUserChanges,
  type QaUserRecord,
  type QaUserStore,
  qaAccount,
} from "./qaAccounts";

/** Firebase Auth over a map, counting every write. */
function memoryUsers(seed: QaUserRecord[] = []) {
  const users = new Map(seed.map((user) => [user.uid, { ...user }]));
  const writes: { kind: "create" | "update"; uid: string; changes?: QaUserChanges }[] =
    [];
  const store: QaUserStore = {
    async get(uid) {
      const user = users.get(uid);
      return user ? { ...user } : null;
    },
    async create(user) {
      if (users.has(user.uid)) throw new Error(`exists: ${user.uid}`);
      users.set(user.uid, { ...user });
      writes.push({ kind: "create", uid: user.uid });
    },
    async update(uid, changes) {
      const user = users.get(uid);
      if (!user) throw new Error(`missing: ${uid}`);
      users.set(uid, { ...user, ...changes });
      writes.push({ kind: "update", uid, changes });
    },
  };
  return { store, users, writes };
}

describe("the QA account pool", () => {
  it("is testuser0 to testuser10, each fixed by its slot", () => {
    expect(QA_ACCOUNTS).toHaveLength(11);
    expect(qaAccount(0)).toEqual({
      slot: 0,
      uid: "qa-testuser-0",
      email: "testuser0@qa.trygroove.app",
      displayName: "QA testuser0",
    });
    expect(qaAccount(10).email).toBe("testuser10@qa.trygroove.app");
  });

  it("has no account outside slots 0 to 10", () => {
    expect(MAX_QA_SLOT).toBe(10);
    for (const slot of [-1, 11, 1.5, Number.NaN]) {
      expect(isQaSlot(slot)).toBe(false);
      expect(() => qaAccount(slot)).toThrow(RangeError);
    }
  });
});

describe("provisionQaAccounts", () => {
  it("creates every account verified and allowlists every address", async () => {
    const { store, users } = memoryUsers();
    const allowlist = createInMemoryAccessRepository();

    const report = await provisionQaAccounts(store, allowlist, 42);

    expect(report.created).toEqual(QA_ACCOUNTS.map((a) => a.email));
    expect(report.updated).toEqual([]);
    expect(report.allowlist.added).toEqual(QA_ACCOUNTS.map((a) => a.email));
    expect(users.get("qa-testuser-3")).toEqual({
      uid: "qa-testuser-3",
      email: "testuser3@qa.trygroove.app",
      emailVerified: true,
      displayName: "QA testuser3",
    });
    expect((await allowlist.listAllowlist()).map((entry) => entry.email).sort()).toEqual(
      QA_ACCOUNTS.map((a) => a.email).sort(),
    );
  });

  it("changes nothing when run a second time", async () => {
    const { store, users, writes } = memoryUsers();
    const allowlist = createInMemoryAccessRepository();
    await provisionQaAccounts(store, allowlist, 42);
    const usersAfterFirst = structuredClone([...users.entries()]);
    const listAfterFirst = await allowlist.listAllowlist();
    const writesAfterFirst = writes.length;

    const report = await provisionQaAccounts(store, allowlist, 99);

    expect(report.created).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.unchanged).toEqual(QA_ACCOUNTS.map((a) => a.email));
    expect(report.allowlist.added).toEqual([]);
    expect(report.allowlist.alreadyListed).toEqual(QA_ACCOUNTS.map((a) => a.email));
    expect(writes).toHaveLength(writesAfterFirst);
    expect([...users.entries()]).toEqual(usersAfterFirst);
    // The entries keep the time they were first added.
    expect(await allowlist.listAllowlist()).toEqual(listAfterFirst);
  });

  it("puts back only what has drifted on an existing account", async () => {
    const { store, users, writes } = memoryUsers([
      {
        uid: "qa-testuser-2",
        email: "testuser2@qa.trygroove.app",
        emailVerified: false,
        displayName: "Renamed",
      },
    ]);

    const report = await provisionQaAccounts(store, createInMemoryAccessRepository(), 1, [
      qaAccount(2),
    ]);

    expect(report.updated).toEqual(["testuser2@qa.trygroove.app"]);
    expect(writes).toEqual([
      {
        kind: "update",
        uid: "qa-testuser-2",
        changes: { emailVerified: true, displayName: "QA testuser2" },
      },
    ]);
    expect(users.get("qa-testuser-2")?.emailVerified).toBe(true);
  });

  it("clears a refused sign-in on record for a QA address", async () => {
    const allowlist = createInMemoryAccessRepository({
      attempts: [
        {
          email: "testuser1@qa.trygroove.app",
          firstAttemptAt: 1,
          lastAttemptAt: 1,
          count: 1,
        },
      ],
    });

    await provisionQaAccounts(memoryUsers().store, allowlist, 5, [qaAccount(1)]);

    expect(await allowlist.listAttempts()).toEqual([]);
  });
});
