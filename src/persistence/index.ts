/**
 * The schema-v1 persistence boundary (PRD section 9.9).
 *
 * `documents.ts` owns the Firestore layout, `projectRepository.ts` the contract
 * every store satisfies, `autosave.ts` the optimistic save behavior PRJ-03
 * requires, and `migrations.ts` the forward-migration harness PRJ-04 requires.
 *
 * `firestoreProjectRepository.ts` is deliberately not re-exported here: it is
 * the only module in this directory that imports `firebase/firestore`, and
 * keeping it off the barrel means unit tests, the audio engine, and the
 * renderer never pull Firebase into their module graph. Import it directly
 * where a real backend is actually wired up.
 */

export * from "./autosave";
export * from "./documentSize";
export * from "./documents";
export * from "./inMemoryProjectRepository";
export * from "./migrations";
export * from "./projectRepository";
