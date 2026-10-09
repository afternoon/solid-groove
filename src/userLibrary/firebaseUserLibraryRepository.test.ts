import type { FirebaseStorage } from "firebase/storage";
import { describe, expect, it, vi } from "vitest";
import { createIdFactory } from "../domain/ids";
import { newUserPack, type UserPack } from "./userPacks";

/**
 * Parallel imports into one pack all rewrite its single document (GRV-77).
 * Firestore gives a contended transaction a handful of retries and then
 * fails it with `failed-precondition`, so the repository must not run two
 * transactions on one pack at once. This stands in for Firestore with a
 * store that fails a transaction whose document changed under it.
 */
const store = vi.hoisted(() => ({ doc: null as unknown, version: 0, running: 0 }));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  runTransaction: async (
    _db: unknown,
    run: (transaction: {
      get(target: unknown): Promise<{ exists(): boolean; data(): unknown }>;
      set(target: unknown, value: unknown): void;
    }) => Promise<unknown>,
  ) => {
    const readVersion = store.version;
    let written: unknown;
    const result = await run({
      get: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { exists: () => true, data: () => store.doc };
      },
      set: (_target, value) => {
        written = value;
      },
    });
    if (store.version !== readVersion) {
      throw Object.assign(new Error("contention"), { code: "failed-precondition" });
    }
    store.doc = written;
    store.version += 1;
    return result;
  },
}));

const { FirebaseUserLibraryRepository } = await import("./firebaseUserLibraryRepository");

describe("FirebaseUserLibraryRepository.updatePack", () => {
  it("keeps every change when many are made to one pack at once", async () => {
    const ids = createIdFactory();
    const pack: UserPack = newUserPack(ids("pack"), "Tones", 1);
    store.doc = pack;
    store.version = 0;
    const repository = new FirebaseUserLibraryRepository(
      {} as never,
      {} as FirebaseStorage,
    );
    const count = 20;
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        repository.updatePack("u1", pack.id, (current) => ({
          ...current,
          modifiedAt: current.modifiedAt + index + 1,
        })),
      ),
    );
    const final = store.doc as UserPack;
    // Each change adds its own (index + 1), so a lost one shows in the sum.
    expect(final.modifiedAt - pack.modifiedAt).toBe((count * (count + 1)) / 2);
  });
});
