// The Firestore favourites store against a real (local) Firestore instance
// (LIB-011, #691).
//
// It runs the same contract suite as the in-memory store, through the real
// security rules, with every session a separately authenticated client — so a
// favourite added in one has to reach the other through the backend.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { favouritesCollectionPath } from "../../src/persistence/favouriteDocuments";
import {
  describeFavouritesRepositoryContract,
  FAVOURITES_OTHER_OWNER,
  FAVOURITES_OWNER,
  KICK,
} from "../../src/persistence/favouritesRepositoryContract";
import { FirestoreFavouritesRepository } from "../../src/persistence/firestoreFavouritesRepository";
import { createManualClock } from "../../src/shared/clock";
import { anonymousContext, createTestEnvironment, emulatorProjectId } from "./setup";

let testEnv: RulesTestEnvironment;
const clock = createManualClock(1_700_000_000_000);

beforeAll(async () => {
  testEnv = await createTestEnvironment(emulatorProjectId("favourites"));
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

function firestoreAs(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

function repositoryFor(uid: string): FirestoreFavouritesRepository {
  return new FirestoreFavouritesRepository(firestoreAs(uid), { clock });
}

describeFavouritesRepositoryContract("firestore", () => ({
  clock,
  repositoryFor,
  reset: async () => testEnv.clearFirestore(),
  seedStoredDocument: async (path, data) =>
    testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
    }),
}));

describe("FirestoreFavouritesRepository against the emulator", () => {
  it("stores one small document holding only the reference and its time", async () => {
    await repositoryFor(FAVOURITES_OWNER).addFavourite(FAVOURITES_OWNER, KICK);

    const snapshot = await getDocs(
      collection(
        firestoreAs(FAVOURITES_OWNER),
        favouritesCollectionPath(FAVOURITES_OWNER),
      ),
    );
    expect(snapshot.docs.map((entry) => entry.data())).toEqual([
      {
        schemaVersion: 1,
        packId: KICK.packId,
        assetId: KICK.assetId,
        favouritedAt: 1_700_000_000_000,
      },
    ]);
  });

  it("refuses to read or change another user's favourites", async () => {
    await repositoryFor(FAVOURITES_OWNER).addFavourite(FAVOURITES_OWNER, KICK);
    const stranger = repositoryFor(FAVOURITES_OTHER_OWNER);

    expect(await stranger.listFavourites(FAVOURITES_OWNER)).toMatchObject({
      ok: false,
      reason: "not_allowed",
      retryable: false,
    });
    expect(await stranger.addFavourite(FAVOURITES_OWNER, KICK)).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
    expect(await stranger.removeFavourite(FAVOURITES_OWNER, KICK)).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });

    const mine = await repositoryFor(FAVOURITES_OWNER).listFavourites(FAVOURITES_OWNER);
    expect(mine.ok && mine.favourites).toHaveLength(1);
  });

  it("reports a denied watch as an error event", async () => {
    const events: string[] = [];
    const unsubscribe = repositoryFor(FAVOURITES_OTHER_OWNER).watchFavourites(
      FAVOURITES_OWNER,
      (event) => events.push(event.kind),
    );
    const started = Date.now();
    while (events.length === 0 && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    unsubscribe();
    expect(events).toEqual(["error"]);
  });

  it("keeps an anonymous user's favourites under the uid an upgrade keeps", async () => {
    // Linking a credential to an anonymous account keeps its uid (PRJ-01), so
    // favourites written as the guest are the registered user's afterwards.
    const guest = new FirestoreFavouritesRepository(
      anonymousContext(testEnv, "anon-upgrading").firestore() as unknown as Firestore,
      { clock },
    );
    expect((await guest.addFavourite("anon-upgrading", KICK)).ok).toBe(true);

    const registered = repositoryFor("anon-upgrading");
    const listed = await registered.listFavourites("anon-upgrading");
    expect(listed.ok && listed.favourites.map((entry) => entry.assetId)).toEqual([
      KICK.assetId,
    ]);
  });
});
