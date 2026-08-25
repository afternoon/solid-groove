// Firebase Emulator suite: exercises firestore.rules against a real (local)
// Firestore instance, per PRD 9.9 ("Security rules enforce ownership/
// collaborator access and must be tested against an emulator before sharing
// ships"). `FND-004` extended this from the prototype's single
// `projects/{id}` document to the schema-v1 three-tier layout.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { SCHEMA_VERSION } from "../../src/domain/entities";
import {
  anonymousContext,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  emulatorProjectId,
} from "./setup";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnvironment(emulatorProjectId("rules"));
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

const PROJECT_A = "prj_aaaaaaaaaaaaaaaaaaaaa";
const PROJECT_B = "prj_bbbbbbbbbbbbbbbbbbbbb";
const CLIP_A = "clp_aaaaaaaaaaaaaaaaaaaaa";
const TRACK_A = "trk_aaaaaaaaaaaaaaaaaaaaa";
const PACK_A = "pak_aaaaaaaaaaaaaaaaaaaaa";

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    name: "Rules fixture",
    ownerId: "owner-a",
    collaboratorIds: [],
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_000_000,
    template: null,
    genre: null,
    packDependencies: [],
    addedPacks: [],
    ...overrides,
  };
}

function childDocument(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

async function seed(path: string[], data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const [collection, id, ...rest] = path;
    await setDoc(doc(context.firestore(), collection, id, ...rest), data);
  });
}

async function seedProject(
  projectId = PROJECT_A,
  overrides: Record<string, unknown> = {},
) {
  await seed(["projects", projectId], metadata(overrides));
}

describe("firestore.rules: projects/{projectId} metadata", () => {
  it("allows the owner to read their own project", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertSucceeds(getDoc(doc(db, "projects", PROJECT_A)));
  });

  it("allows a collaborator to read the project", async () => {
    await seedProject(PROJECT_A, { collaboratorIds: ["owner-b"] });
    const db = testEnv.authenticatedContext("owner-b").firestore();
    await assertSucceeds(getDoc(doc(db, "projects", PROJECT_A)));
  });

  it("denies reading a project owned by someone else", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-b").firestore();
    await assertFails(getDoc(doc(db, "projects", PROJECT_A)));
  });

  it("denies reading without authentication", async () => {
    await seedProject();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "projects", PROJECT_A)));
  });

  it("lets an anonymous identity create and read its own project", async () => {
    // PRJ-01: an anonymous visitor owns real projects before registering.
    const db = anonymousContext(testEnv, "anon-1").firestore();
    await assertSucceeds(
      setDoc(doc(db, "projects", PROJECT_A), metadata({ ownerId: "anon-1" })),
    );
    await assertSucceeds(getDoc(doc(db, "projects", PROJECT_A)));
  });

  it("denies one anonymous identity reading another's project", async () => {
    await seedProject(PROJECT_A, { ownerId: "anon-1" });
    const db = anonymousContext(testEnv, "anon-2").firestore();
    await assertFails(getDoc(doc(db, "projects", PROJECT_A)));
  });

  it("denies creating a project owned by someone else", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A), metadata({ ownerId: "owner-b" })),
    );
  });

  it("denies a malformed metadata document", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(setDoc(doc(db, "projects", PROJECT_A), { ownerId: "owner-a" }));
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_A),
        metadata({ revision: "zero" as unknown as number }),
      ),
    );
    await assertFails(setDoc(doc(db, "projects", PROJECT_A), metadata({ name: "" })));
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A), metadata({ latestSnapshot: { song: {} } })),
    );
  });

  it("requires a pack dependency list, and takes one that is not empty", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore();
    const { packDependencies: _omitted, ...withoutList } = metadata();
    await assertFails(setDoc(doc(db, "projects", PROJECT_A), withoutList));
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A), metadata({ packDependencies: "none" })),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_A),
        metadata({
          packDependencies: [{ packId: PACK_A, version: "1.0.0" }],
        }),
      ),
    );
  });

  it("requires the pack shelf list (addedPacks), and takes a non-empty one", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore();
    const { addedPacks: _omitted, ...withoutShelf } = metadata();
    await assertFails(setDoc(doc(db, "projects", PROJECT_A), withoutShelf));
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A), metadata({ addedPacks: "none" })),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_A),
        metadata({
          packDependencies: [{ packId: PACK_A, version: "1.0.0" }],
          addedPacks: [{ packId: PACK_A, version: "1.0.0" }],
        }),
      ),
    );
  });

  it("denies a metadata document from an unknown schema version", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_A),
        metadata({ schemaVersion: SCHEMA_VERSION + 1 }),
      ),
    );
  });

  it("allows the owner to update their own project", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertSucceeds(
      setDoc(doc(db, "projects", PROJECT_A), metadata({ name: "Renamed", revision: 1 })),
    );
  });

  it("denies an update that reassigns ownership", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(updateDoc(doc(db, "projects", PROJECT_A), { ownerId: "owner-b" }));
  });

  it("denies an update that moves the revision backwards", async () => {
    await seedProject(PROJECT_A, { revision: 5 });
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(setDoc(doc(db, "projects", PROJECT_A), metadata({ revision: 4 })));
  });

  it("denies another user updating or deleting the project", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-b").firestore();
    await assertFails(updateDoc(doc(db, "projects", PROJECT_A), { name: "hijacked" }));
    await assertFails(deleteDoc(doc(db, "projects", PROJECT_A)));
  });

  it("allows the owner to delete the project", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertSucceeds(deleteDoc(doc(db, "projects", PROJECT_A)));
  });

  it("denies a collaborator deleting the project", async () => {
    await seedProject(PROJECT_A, { collaboratorIds: ["owner-b"] });
    const db = testEnv.authenticatedContext("owner-b").firestore();
    await assertFails(deleteDoc(doc(db, "projects", PROJECT_A)));
  });
});

describe("firestore.rules: song, clip, and arrangement tiers", () => {
  it("lets the owner write and read every child tier", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();

    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_A, "song", "current"),
        childDocument(PROJECT_A, { tempo: 120 }),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_A, "clips", CLIP_A),
        childDocument(PROJECT_A, { id: CLIP_A }),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_A, "arrangement", TRACK_A),
        childDocument(PROJECT_A, { trackId: TRACK_A, placements: [] }),
      ),
    );
    await assertSucceeds(getDoc(doc(db, "projects", PROJECT_A, "song", "current")));
  });

  it("denies a non-member reading or writing a child document", async () => {
    await seedProject();
    await seed(["projects", PROJECT_A, "song", "current"], childDocument(PROJECT_A));
    const db = testEnv.authenticatedContext("owner-b").firestore();

    await assertFails(getDoc(doc(db, "projects", PROJECT_A, "song", "current")));
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A, "song", "current"), childDocument(PROJECT_A)),
    );
    await assertFails(deleteDoc(doc(db, "projects", PROJECT_A, "song", "current")));
  });

  it("denies an unauthenticated read of a child document", async () => {
    await seedProject();
    await seed(
      ["projects", PROJECT_A, "clips", CLIP_A],
      childDocument(PROJECT_A, { id: CLIP_A }),
    );
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "projects", PROJECT_A, "clips", CLIP_A)));
  });

  it("denies a child document that claims another project", async () => {
    await seedProject(PROJECT_A);
    await seedProject(PROJECT_B, { ownerId: "owner-a" });
    const db = testEnv.authenticatedContext("owner-a").firestore();

    // Even the owner of both projects cannot file B's clip under A: the
    // document would then disagree with the path it lives at.
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_A, "clips", CLIP_A),
        childDocument(PROJECT_B, { id: CLIP_A }),
      ),
    );
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A, "song", "current"), childDocument(PROJECT_B)),
    );
  });

  it("denies a clip whose ID disagrees with its document path", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_A, "clips", CLIP_A),
        childDocument(PROJECT_A, { id: "clp_somethingelse00000" }),
      ),
    );
  });

  it("denies a malformed or unversioned child document", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();

    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A, "song", "current"), {
        tempo: 120,
      }),
    );
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_A, "song", "current"),
        childDocument(PROJECT_A, { schemaVersion: 3 }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_A, "song", "current"),
        childDocument(PROJECT_A, { revision: -1 }),
      ),
    );
  });

  it("denies a second song document beside song/current", async () => {
    await seedProject();
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(
      setDoc(doc(db, "projects", PROJECT_A, "song", "draft"), childDocument(PROJECT_A)),
    );
  });

  it("denies writing a child document for a project that does not exist", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertFails(
      setDoc(
        doc(db, "projects", PROJECT_B, "clips", CLIP_A),
        childDocument(PROJECT_B, { id: CLIP_A }),
      ),
    );
  });

  it("lets a collaborator edit clips but not delete the project", async () => {
    await seedProject(PROJECT_A, { collaboratorIds: ["owner-b"] });
    const db = testEnv.authenticatedContext("owner-b").firestore();

    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_A, "clips", CLIP_A),
        childDocument(PROJECT_A, { id: CLIP_A }),
      ),
    );
    await assertFails(deleteDoc(doc(db, "projects", PROJECT_A)));
  });

  it("lets the owner delete a clip document", async () => {
    await seedProject();
    await seed(
      ["projects", PROJECT_A, "clips", CLIP_A],
      childDocument(PROJECT_A, { id: CLIP_A }),
    );
    const db = testEnv.authenticatedContext("owner-a").firestore();
    await assertSucceeds(deleteDoc(doc(db, "projects", PROJECT_A, "clips", CLIP_A)));
  });
});
