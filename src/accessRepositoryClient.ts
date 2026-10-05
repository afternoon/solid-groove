import type { AccessRepository } from "./access/accessRepository";
import { isMockBackend } from "./devBackend";

/**
 * The admin page's `AccessRepository` (#854), chosen the way the other
 * repository clients choose theirs: the mock backend gets the in-memory
 * store, everything else (the emulator included) gets Firestore, imported
 * dynamically so `firebase/firestore` stays out of graphs that never ask.
 */
let cached: Promise<AccessRepository> | null = null;

export function getAccessRepository(): Promise<AccessRepository> {
  cached ??= createAccessRepository();
  return cached;
}

async function createAccessRepository(): Promise<AccessRepository> {
  if (isMockBackend) {
    const { createInMemoryAccessRepository } = await import(
      "./access/inMemoryAccessRepository"
    );
    return createInMemoryAccessRepository();
  }
  const [{ FirestoreAccessRepository }, { db }] = await Promise.all([
    import("./access/firestoreAccessRepository"),
    import("./firebaseConfig"),
  ]);
  return new FirestoreAccessRepository(db);
}
