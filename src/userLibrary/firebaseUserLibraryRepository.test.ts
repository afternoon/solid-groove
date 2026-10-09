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

/**
 * A small file goes up in one request; when that request fails on the network
 * after it reached the bucket, the SDK's repeat is refused by the create-only
 * rule (GRV-77). This stands in for Storage with an upload that fails that way
 * and an object that may or may not be stored.
 */
const bucket = vi.hoisted(() => ({ storedSize: null as number | null }));

vi.mock("firebase/storage", () => ({
  connectStorageEmulator: vi.fn(),
  deleteObject: vi.fn(),
  getBytes: vi.fn(),
  getStorage: vi.fn(),
  ref: vi.fn(() => ({})),
  getMetadata: async () => {
    if (bucket.storedSize === null) {
      throw Object.assign(new Error("missing"), { code: "storage/object-not-found" });
    }
    return { size: bucket.storedSize };
  },
  uploadBytesResumable: () => ({
    cancel: vi.fn(),
    on: (_event: string, _next: unknown, error: (failure: Error) => void) => {
      setTimeout(() =>
        error(Object.assign(new Error("403"), { code: "storage/unauthorized" })),
      );
    },
  }),
}));

const { FirebaseUserLibraryRepository } = await import("./firebaseUserLibraryRepository");
const { UserLibraryError } = await import("./userLibraryRepository");

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

describe("FirebaseUserLibraryRepository.uploadAudio", () => {
  const repository = new FirebaseUserLibraryRepository(
    {} as never,
    {} as FirebaseStorage,
  );
  const file = new Blob([new Uint8Array(53_000)]);

  it("succeeds when a refused repeat finds its first attempt already stored", async () => {
    bucket.storedSize = file.size;
    await expect(
      repository.uploadAudio("users/u1/packs/pak_1/ast_1", file, "audio/wav"),
    ).resolves.toBeUndefined();
  });

  it("still fails as refused when nothing of the file's size is stored", async () => {
    for (const storedSize of [null, file.size - 1]) {
      bucket.storedSize = storedSize;
      const failure = await repository
        .uploadAudio("users/u1/packs/pak_1/ast_1", file, "audio/wav")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(UserLibraryError);
      expect((failure as InstanceType<typeof UserLibraryError>).reason).toBe(
        "permission_denied",
      );
    }
  });
});
