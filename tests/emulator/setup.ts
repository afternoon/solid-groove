// Firebase Emulator setup/teardown helper.
//
// `bun run test:emulator` wraps `vitest run --config vitest.emulator.config.ts`
// in `firebase emulators:exec`, which starts the emulators declared in
// `firebase.json`, sets `FIRESTORE_EMULATOR_HOST` (and friends) in the child
// process's environment, runs the suite, then shuts the emulators down
// however the suite exited. Tests never start or stop the emulator process
// themselves — they only open/close a `RulesTestEnvironment` against it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

export const EMULATOR_PROJECT_ID = "demo-solid-groove";

/**
 * Test files run in parallel against one emulator, and `clearFirestore()` wipes
 * a whole project. Each file therefore uses its own `demo-` project ID so one
 * file's teardown cannot delete another file's data mid-test.
 */
export function emulatorProjectId(suite: string): string {
  return `${EMULATOR_PROJECT_ID}-${suite}`;
}

function parseHostAndPort(
  envValue: string | undefined,
  fallbackPort: number,
): { host: string; port: number } {
  const [host, portStr] = (envValue ?? `127.0.0.1:${fallbackPort}`).split(":");
  return { host, port: Number(portStr) };
}

/**
 * Opens a `RulesTestEnvironment` against the running Firestore emulator,
 * loaded with the project's real `firestore.rules`. Reads
 * `FIRESTORE_EMULATOR_HOST` (set by `firebase emulators:exec`) so tests never
 * hardcode a host/port that could drift from `firebase.json`.
 */
export async function createTestEnvironment(
  projectId: string = EMULATOR_PROJECT_ID,
): Promise<RulesTestEnvironment> {
  const firestore = parseHostAndPort(process.env.FIRESTORE_EMULATOR_HOST, 8080);

  return initializeTestEnvironment({
    projectId,
    firestore: {
      ...firestore,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
}

/**
 * A context for an anonymous Firebase identity (PRJ-01). It is an ordinary
 * authenticated identity whose sign-in provider happens to be `anonymous`, so
 * the rules treat it exactly like a registered user's.
 */
export function anonymousContext(
  testEnv: RulesTestEnvironment,
  uid: string,
): ReturnType<RulesTestEnvironment["authenticatedContext"]> {
  return testEnv.authenticatedContext(uid, {
    firebase: { sign_in_provider: "anonymous" },
  });
}

export { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
