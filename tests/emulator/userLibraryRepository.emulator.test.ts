// The personal-library repository (#282) against real (local) Firestore and
// Cloud Storage emulators, through the real security rules.
//
// It runs the same contract suite as the in-memory repository the browser
// suites use, so that fake is held to what the backend actually does: atomic
// pack updates, upload progress, cancellation that stores nothing, deletes
// that tolerate what is already gone.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { type FirebaseStorage, getBytes, getMetadata, ref } from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PackId } from "../../src/domain/ids";
import { createSeededIdFactory } from "../../src/domain/ids";
import { createLibraryAsset, toLibrarySample } from "../../src/library/insertion";
import { packAudioPath } from "../../src/userData/userData";
import { FirebaseUserLibraryRepository } from "../../src/userLibrary/firebaseUserLibraryRepository";
import { describeUserLibraryRepositoryContract } from "../../src/userLibrary/userLibraryRepositoryContract";
import {
  addSound,
  type NewUserPackAsset,
  newUserPack,
  userPackAssets,
} from "../../src/userLibrary/userPacks";
import {
  assertFails,
  createTestEnvironment,
  emulatorProjectId,
  registeredContext,
} from "./setup";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnvironment(emulatorProjectId("userlibrary"), {
    storage: true,
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describeUserLibraryRepositoryContract("firebase", () => ({
  repositoryFor(uid) {
    const context = registeredContext(testEnv, uid);
    return new FirebaseUserLibraryRepository(
      context.firestore() as unknown as Firestore,
      context.storage() as unknown as FirebaseStorage,
    );
  },
  async hasAudio(path) {
    let found = false;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      found = await getMetadata(
        ref(context.storage() as unknown as FirebaseStorage, path),
      ).then(
        () => true,
        () => false,
      );
    });
    return found;
  },
}));

// Nothing a producer imports reaches anyone else through a project (#282):
// inserting a personal sound writes only where it is stored, never a URL, and
// reading that path as anyone but the owner is refused by `storage.rules` —
// a collaborator who can read the project still cannot hear the sound.
describe("a personal sound inserted into a project", () => {
  const OWNER = "insert-owner";
  const OTHER = "insert-collaborator";
  const PACK_ID = "pak_insertinsertinsertin1" as PackId;
  const ASSET_ID = "ast_insertinsertinsertin1";

  function repositoryFor(uid: string): FirebaseUserLibraryRepository {
    const context = registeredContext(testEnv, uid);
    return new FirebaseUserLibraryRepository(
      context.firestore() as unknown as Firestore,
      context.storage() as unknown as FirebaseStorage,
    );
  }

  it("carries no URL, and its audio is readable by its owner alone", async () => {
    const owner = repositoryFor(OWNER);
    const path = packAudioPath(OWNER, PACK_ID, ASSET_ID);
    await owner.uploadAudio(path, new Blob([new Uint8Array(64).fill(3)]), "audio/wav");
    const pack = addSound(
      newUserPack(PACK_ID, "Field Recordings", 1),
      {
        id: ASSET_ID as NewUserPackAsset["id"],
        name: "tape kick",
        type: "one-shot",
        family: "drums",
        role: "kick",
        storagePath: path,
        contentType: "audio/wav",
        sizeBytes: 64,
        durationSeconds: 0.1,
        sampleRate: 44_100,
        channelCount: 1,
        bpm: null,
        peaks: null,
        createdAt: 2,
      },
      2,
    );
    await owner.createPack(OWNER, pack);

    const sample = toLibrarySample(userPackAssets(pack)[0]);
    if (!sample) throw new Error("the personal sound is not insertable");
    const asset = createLibraryAsset(
      { ids: createSeededIdFactory("insert"), now: () => 1 },
      sample,
    );
    expect(asset.storageRef).toBe(path);
    expect(asset.url).toBeNull();
    expect(JSON.stringify(asset)).not.toMatch(/https?:|token/i);

    expect((await owner.readAudio(asset.storageRef)).byteLength).toBe(64);
    await expect(repositoryFor(OTHER).readAudio(asset.storageRef)).rejects.toMatchObject({
      reason: "permission_denied",
    });
    await assertFails(
      getBytes(
        ref(
          registeredContext(testEnv, OTHER).storage() as unknown as FirebaseStorage,
          asset.storageRef,
        ),
      ),
    );
  });
});
