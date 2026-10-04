import { isMockBackend } from "../devBackend";
import type { UserLibraryRepository } from "./userLibraryRepository";

/**
 * The application's personal-library repository (#282), chosen the way
 * `projectRepositoryClient.ts` chooses the project one: memory for the mock
 * backend, Firestore and Cloud Storage for everything else, the emulators
 * included.
 *
 * The Firebase module is imported dynamically so the mock build never loads
 * the SDK, and memoized so every surface shares one instance per page load.
 */

let cached: Promise<UserLibraryRepository> | null = null;

export function getUserLibraryRepository(): Promise<UserLibraryRepository> {
  cached ??= createUserLibraryRepository();
  return cached;
}

async function createUserLibraryRepository(): Promise<UserLibraryRepository> {
  if (isMockBackend) {
    const { createInMemoryUserLibraryRepository } = await import(
      "./inMemoryUserLibraryRepository"
    );
    // Slow enough to see each file's progress while driving the mock app.
    return createInMemoryUserLibraryRepository({ uploadMs: 900 });
  }
  const [{ createFirebaseUserLibraryRepository }, { app }] = await Promise.all([
    import("./firebaseUserLibraryRepository"),
    import("../firebaseConfig"),
  ]);
  return createFirebaseUserLibraryRepository(app);
}
