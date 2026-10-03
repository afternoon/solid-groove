import { describe, expect, it } from "vitest";
import type { PackId } from "../domain/ids";
import { createManualClock } from "../shared/clock";
import { createInMemoryUserLibraryRepository } from "./inMemoryUserLibraryRepository";
import { deleteUserPack, deleteUserSound } from "./packOperations";
import { describeUserLibraryRepositoryContract } from "./userLibraryRepositoryContract";
import { addSound, newUserPack, type UserPack } from "./userPacks";

describeUserLibraryRepositoryContract("in-memory", () => {
  const repository = createInMemoryUserLibraryRepository();
  return {
    repositoryFor: () => repository,
    hasAudio: async (path) => repository.objects.has(path),
  };
});

const UID = "u1";
const PACK_ID = "pak_operationsoperations1" as PackId;

function packWith(ids: string[]): UserPack {
  let pack = newUserPack(PACK_ID, "Pack", 1);
  for (const id of ids) {
    pack = addSound(
      pack,
      {
        id: id as UserPack["assets"][number]["id"],
        name: id,
        type: "one-shot",
        family: "drums",
        role: "kick",
        storagePath: `users/${UID}/packs/${PACK_ID}/${id}`,
        url: "u",
        contentType: "audio/wav",
        sizeBytes: 10,
        durationSeconds: 0.1,
        sampleRate: null,
        channelCount: 1,
        bpm: null,
        peaks: null,
        createdAt: 1,
      },
      1,
    );
  }
  return pack;
}

async function seeded(ids: string[]) {
  const repository = createInMemoryUserLibraryRepository();
  const pack = packWith(ids);
  await repository.createPack(UID, pack);
  for (const asset of pack.assets) {
    await repository.uploadAudio(
      asset.storagePath,
      new Blob(["x".repeat(10)]),
      "audio/wav",
    );
  }
  return { repository, pack };
}

describe("deleting from a personal library", () => {
  it("removes a sound from its pack and then its audio", async () => {
    const { repository, pack } = await seeded([
      "ast_aaaaaaaaaaaaaaaaaaaa1",
      "ast_aaaaaaaaaaaaaaaaaaaa2",
    ]);
    await deleteUserSound(
      repository,
      UID,
      PACK_ID,
      "ast_aaaaaaaaaaaaaaaaaaaa1",
      createManualClock(5),
    );
    const after = await repository.updatePack(UID, PACK_ID, (p) => p);
    expect(after.assets.map((asset) => asset.id)).toEqual(["ast_aaaaaaaaaaaaaaaaaaaa2"]);
    expect(after.version).toBe("2.0.0");
    expect([...repository.objects.keys()]).toEqual([pack.assets[1].storagePath]);
  });

  it("removes a pack's audio and then the pack", async () => {
    const { repository, pack } = await seeded(["ast_aaaaaaaaaaaaaaaaaaaa1"]);
    await deleteUserPack(repository, UID, pack);
    expect(repository.objects.size).toBe(0);
    await expect(repository.updatePack(UID, PACK_ID, (p) => p)).rejects.toMatchObject({
      reason: "not_found",
    });
  });

  it("counts what is stored against the account", async () => {
    const { repository } = await seeded(["ast_aaaaaaaaaaaaaaaaaaaa1"]);
    const used = await new Promise<number>((resolve) => {
      const stop = repository.watchUsage(UID, (bytes) => {
        stop();
        resolve(bytes);
      });
    });
    expect(used).toBe(10);
  });
});
