import type { FirebaseApp } from "firebase/app";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { CLOUD_FUNCTIONS_REGION } from "../shared/cloudFunctions";
import type { RevokeAccessCall } from "./firestoreAccessRepository";
import {
  REVOKE_ACCESS_CALLABLE,
  type RevokeAccessRequest,
  type RevokeAccessResult,
} from "./revokeAccess";

/**
 * The browser's side of the `revokeAccess` callable (#1147): the one place
 * `firebase/functions` is imported, loaded only with the admin page's
 * repository. Firebase sends the caller's ID token with the call, which is
 * how the function knows the caller is an admin; the decision is the
 * function's (`src/access/revokeAccess.ts`), never made here.
 *
 * `emulatorHost` is the Functions emulator (`src/devBackend.ts`), or `null`
 * for the real project.
 */
export function createRevokeAccessCall(
  app: FirebaseApp,
  emulatorHost: string | null,
): RevokeAccessCall {
  const functions = getFunctions(app, CLOUD_FUNCTIONS_REGION);
  if (emulatorHost) {
    const [host, port] = emulatorHost.split(":");
    connectFunctionsEmulator(functions, host, Number(port));
  }
  const call = httpsCallable<RevokeAccessRequest, RevokeAccessResult>(
    functions,
    REVOKE_ACCESS_CALLABLE,
  );
  return async (email) => (await call({ email })).data;
}
