import { isMockBackend } from "./devBackend";
import type { FavouritesRepository } from "./persistence/favouritesRepository";

/**
 * The application's `FavouritesRepository` (LIB-011, #691), chosen the way
 * `projectRepositoryClient.ts` chooses the project store: the mock backend
 * gets the in-memory store, everything else (the emulator included) gets
 * Firestore. `firestoreFavouritesRepository.ts` is imported dynamically so
 * `firebase/firestore` stays out of any module graph that does not ask for it.
 *
 * Memoized, so every surface of one page load shares one store — which is what
 * lets the in-memory store stand in for "another session" in the mock backend.
 */

let cached: Promise<FavouritesRepository> | null = null;

export function getFavouritesRepository(): Promise<FavouritesRepository> {
  cached ??= createFavouritesRepository();
  return cached;
}

async function createFavouritesRepository(): Promise<FavouritesRepository> {
  if (isMockBackend) {
    const { createInMemoryFavouritesRepository } = await import(
      "./persistence/inMemoryFavouritesRepository"
    );
    return createInMemoryFavouritesRepository();
  }
  const [{ FirestoreFavouritesRepository }, { db }] = await Promise.all([
    import("./persistence/firestoreFavouritesRepository"),
    import("./firebaseConfig"),
  ]);
  return new FirestoreFavouritesRepository(db);
}

/** Test-only: forget the memoized repository so each test starts fresh. */
export function __resetFavouritesRepositoryClientForTests(): void {
  cached = null;
}
