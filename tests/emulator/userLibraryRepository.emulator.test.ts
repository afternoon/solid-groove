// The personal-library repository (#282) against real (local) Firestore and
// Cloud Storage emulators, through the real security rules.
//
// It runs the same contract suite as the in-memory repository the browser
// suites use, so that fake is held to what the backend actually does: atomic
// pack updates, upload progress, cancellation that stores nothing, deletes
// that tolerate what is already gone.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { type FirebaseStorage, getMetadata, ref } from "firebase/storage";
import { afterAll, beforeAll } from "vitest";
import { FirebaseUserLibraryRepository } from "../../src/userLibrary/firebaseUserLibraryRepository";
import { describeUserLibraryRepositoryContract } from "../../src/userLibrary/userLibraryRepositoryContract";
import { createTestEnvironment, emulatorProjectId, registeredContext } from "./setup";

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
