import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PackId } from "../domain/ids";
import { packAudioPath } from "../userData/userData";
import type { UserLibraryRepository } from "./userLibraryRepository";
import { addSound, type NewUserPackAsset, newUserPack, type UserPack } from "./userPacks";

/**
 * The personal-library repository contract (#282).
 *
 * The in-memory repository runs it as a unit test and the Firebase one runs it
 * against the emulators (`tests/emulator/userLibraryRepository.emulator.test.ts`),
 * so the fake the browser suites use behaves like what it stands in for.
 */

export interface UserLibraryContractHarness {
  /** A repository acting as `uid`, a registered account. */
  repositoryFor(uid: string): UserLibraryRepository;
  /** Whether stored audio exists at `path`. */
  hasAudio(path: string): Promise<boolean>;
  reset?(): Promise<void>;
}

const PACK_ID = "pak_contractcontractcont1" as PackId;

/** Distinct per run, so a store that outlives one test cannot answer the next. */
let runs = 0;
const uid = () => `contract-user-${Date.now().toString(36)}-${++runs}`;

function soundIn(packId: string, owner: string, id: string): NewUserPackAsset {
  return {
    id: id as NewUserPackAsset["id"],
    name: "tape kick",
    type: "one-shot",
    family: "drums",
    role: "kick",
    storagePath: packAudioPath(owner, packId, id),
    contentType: "audio/wav",
    sizeBytes: 8,
    durationSeconds: 0.1,
    sampleRate: 44_100,
    channelCount: 1,
    bpm: null,
    peaks: null,
    createdAt: 2,
  };
}

/** The next value a subscription delivers that satisfies `accept`. */
function nextValue<T>(
  subscribe: (listener: (value: T) => void) => () => void,
  accept: (value: T) => boolean,
): Promise<T> {
  return new Promise((resolve) => {
    const stop = subscribe((value) => {
      if (!accept(value)) return;
      queueMicrotask(() => stop());
      resolve(value);
    });
  });
}

export function describeUserLibraryRepositoryContract(
  name: string,
  harness: () => UserLibraryContractHarness,
): void {
  describe(`UserLibraryRepository contract (${name})`, () => {
    let h: UserLibraryContractHarness;
    beforeEach(() => {
      h = harness();
    });
    afterEach(async () => {
      await h.reset?.();
    });

    const watchPacks =
      (repository: UserLibraryRepository, owner: string) =>
      (listener: (packs: readonly UserPack[]) => void) =>
        repository.watchPacks(owner, listener, () => undefined);

    it("lists a created pack to its owner", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      const pack = newUserPack(PACK_ID, "Field Recordings", 1);
      await repository.createPack(owner, pack);
      const packs = await nextValue(watchPacks(repository, owner), (p) => p.length === 1);
      expect(packs[0]).toEqual(pack);
    });

    it("tells a watcher about every change", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      const seen = nextValue(watchPacks(repository, owner), (packs) =>
        packs.some((pack) => pack.name === "Renamed"),
      );
      await repository.createPack(owner, newUserPack(PACK_ID, "First", 1));
      await repository.updatePack(owner, PACK_ID, (pack) => ({
        ...pack,
        name: "Renamed",
      }));
      expect((await seen)[0].name).toBe("Renamed");
    });

    it("keeps both of two updates made at once", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      await repository.createPack(owner, newUserPack(PACK_ID, "Pack", 1));
      await Promise.all(
        ["ast_contractcontractcont1", "ast_contractcontractcont2"].map((id) =>
          repository.updatePack(owner, PACK_ID, (pack) =>
            addSound(pack, soundIn(PACK_ID, owner, id), 2),
          ),
        ),
      );
      const packs = await nextValue(
        watchPacks(repository, owner),
        (p) => p[0]?.assets.length === 2,
      );
      expect(packs[0].version).toBe("1.2.0");
    });

    it("refuses to update a pack that does not exist", async () => {
      const owner = uid();
      await expect(
        h.repositoryFor(owner).updatePack(owner, PACK_ID, (pack) => pack),
      ).rejects.toMatchObject({ reason: "not_found" });
    });

    it("deletes a pack", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      await repository.createPack(owner, newUserPack(PACK_ID, "Gone", 1));
      await repository.deletePack(owner, PACK_ID);
      await nextValue(watchPacks(repository, owner), (packs) => packs.length === 0);
    });

    it("stores audio, reports progress, and deletes it", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      const path = packAudioPath(owner, PACK_ID, "ast_contractcontractcont3");
      const progress: number[] = [];
      await repository.uploadAudio(
        path,
        new Blob([new Uint8Array(32).fill(7)]),
        "audio/wav",
        { onProgress: (fraction) => progress.push(fraction) },
      );
      expect(progress.at(-1)).toBe(1);
      expect(await h.hasAudio(path)).toBe(true);
      // The owner reads the bytes back through the repository: there is no
      // URL to hand around (#282).
      const bytes = new Uint8Array(await repository.readAudio(path));
      expect([...bytes]).toEqual(new Array(32).fill(7));
      await repository.deleteAudio(path);
      expect(await h.hasAudio(path)).toBe(false);
      // Deleting what is already gone is not an error.
      await repository.deleteAudio(path);
    });

    it("reads only user data, and reports audio that is gone as not found", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      await expect(
        repository.readAudio(packAudioPath(owner, PACK_ID, "ast_contractcontractcont5")),
      ).rejects.toMatchObject({ reason: "not_found" });
      await expect(repository.readAudio("library/audio/kick.wav")).rejects.toMatchObject({
        reason: "not_found",
      });
    });

    it("stores nothing for a cancelled upload", async () => {
      const owner = uid();
      const repository = h.repositoryFor(owner);
      const path = packAudioPath(owner, PACK_ID, "ast_contractcontractcont4");
      const controller = new AbortController();
      controller.abort();
      await expect(
        repository.uploadAudio(path, new Blob([new Uint8Array(32)]), "audio/wav", {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ reason: "cancelled" });
      expect(await h.hasAudio(path)).toBe(false);
    });

    it("reports a usage total, zero for a new account", async () => {
      const owner = uid();
      const used = await nextValue(
        (listener: (bytes: number) => void) =>
          h.repositoryFor(owner).watchUsage(owner, listener),
        () => true,
      );
      expect(used).toBe(0);
    });
  });
}
