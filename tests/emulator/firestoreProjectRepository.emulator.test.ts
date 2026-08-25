// The Firestore repository against a real (local) Firestore instance.
//
// It runs the same contract suite as the in-memory repository, so the fake used
// by unit, component, and browser tests is held to the behavior of the backend
// it stands in for: revision-checked writes, chunk overflow, tier isolation and
// watch notifications all have to work the same way here.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSliceFixtureProject } from "../../src/domain/fixtures";
import { FirestoreProjectRepository } from "../../src/persistence/firestoreProjectRepository";
import { describeProjectRepositoryContract } from "../../src/persistence/projectRepositoryContract";
import { createManualClock } from "../../src/shared/clock";
import { createTestEnvironment, emulatorProjectId } from "./setup";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnvironment(emulatorProjectId("repository"));
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

/**
 * The fixtures are owned by `user_fixture`, so the repository runs as that
 * identity and every read and write also passes through the real security
 * rules rather than around them.
 */
function repositoryFor(uid = "user_fixture"): FirestoreProjectRepository {
  const db = testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
  return new FirestoreProjectRepository(db, {
    clock: createManualClock(1_700_000_100_000),
  });
}

describeProjectRepositoryContract("firestore", () => ({
  repositoryFor,
  reset: async () => testEnv.clearFirestore(),
}));

describe("FirestoreProjectRepository against the emulator", () => {
  it("leaves the song document untouched when only a clip changes", async () => {
    const repository = repositoryFor();
    const project = createSliceFixtureProject();
    await repository.createProject(project);

    const songRef = doc(
      testEnv.authenticatedContext("user_fixture").firestore(),
      "projects",
      project.metadata.id,
      "song",
      "current",
    );
    const before = (await getDoc(songRef)).data();

    const saved = await repository.saveClip(
      project.metadata.id,
      project.clips[0],
      project.metadata.revision,
    );
    expect(saved.ok).toBe(true);

    const after = (await getDoc(songRef)).data();
    expect(after).toEqual(before);
  });

  it("refuses to read or write another user's project", async () => {
    const owner = repositoryFor();
    const project = createSliceFixtureProject();
    await owner.createProject(project);

    const stranger = repositoryFor("someone-else");

    // Denied access is reported as not-found so the API never confirms that a
    // project the caller may not see exists.
    const loaded = await stranger.loadProject(project.metadata.id);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe("not_found");

    const saved = await stranger.saveMetadata(
      project.metadata.id,
      { name: "Stolen" },
      project.metadata.revision,
    );
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.retryable).toBe(false);

    const stillMine = await owner.loadProjectMetadata(project.metadata.id);
    expect(stillMine.ok).toBe(true);
    if (!stillMine.ok) return;
    expect(stillMine.value.name).toBe(project.metadata.name);
  });

  it("does not list another user's projects", async () => {
    const owner = repositoryFor();
    await owner.createProject(createSliceFixtureProject());

    expect(await repositoryFor("someone-else").listProjects("user_fixture")).toEqual([]);
  });
});
