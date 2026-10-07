/**
 * Which backend the app talks to, and the emulator hosts that implies.
 *
 * One env var selects the backend: `VITE_DEV_BACKEND`.
 *
 * | Value      | Backend                                                    |
 * | ---------- | ---------------------------------------------------------- |
 * | `mock`     | In-memory fakes; the Firebase SDK is never loaded          |
 * | `emulator` | The *real* Firebase SDK against local Firestore/Auth/Storage |
 * | unset      | The real Firebase project in `.env` (production behavior)  |
 *
 * The distinction between the first two is the whole point of having three
 * modes rather than a boolean: the mock backend swaps in a fake that resets on
 * every page load, so it structurally cannot demonstrate persistence, while
 * `emulator` exercises the genuine SDK, security rules, and a real reload.
 *
 * Unset is deliberately the default rather than `mock`. A missing or misspelled
 * value must not silently redirect a real deployment at a fake, and CI builds
 * set nothing at all.
 *
 * An unrecognized value throws rather than falling back. This is read once at
 * startup from a developer's own `.env`, and the failure it prevents —
 * `VITE_DEV_BACKEND=mocks` quietly running against production credentials — is
 * far worse than a loud message at boot.
 */

export type DevBackend = "mock" | "emulator" | "project";

const DEV_BACKENDS: readonly DevBackend[] = ["mock", "emulator", "project"];

/**
 * Where `bun run dev:emulator` starts the emulators, matching `firebase.json`.
 *
 * IPv4 literals, not `localhost`: the emulators bind `127.0.0.1` only, so on a
 * host where `localhost` resolves to `::1` first the connection is refused.
 */
export const DEFAULT_FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
export const DEFAULT_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
/** Where personal packs upload their audio in emulator mode (#282). */
export const DEFAULT_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
export const DEFAULT_FUNCTIONS_EMULATOR_HOST = "127.0.0.1:5001";

/**
 * The emulator's project ID, matching `bun run firebase:emulator` and both
 * emulator test suites.
 *
 * The emulator partitions data by project ID, so this is not cosmetic: with a
 * different value the app writes to a parallel `projects/<other>/…` tree that
 * `firebase emulators:export` and every documented inspection command miss
 * entirely. The data is there, just not where anyone looks for it.
 *
 * The `demo-` prefix is Firebase's convention for emulator-only work — the CLI
 * refuses to reach any non-emulated service for such a project.
 */
export const EMULATOR_PROJECT_ID = "demo-solid-groove";

/** Resolves the selected backend, throwing on an unrecognized value. */
export function resolveDevBackend(
  raw: string | undefined = import.meta.env.VITE_DEV_BACKEND,
): DevBackend {
  if (raw === undefined || raw === "") return "project";
  if ((DEV_BACKENDS as readonly string[]).includes(raw)) return raw as DevBackend;
  throw new Error(
    `VITE_DEV_BACKEND must be one of ${DEV_BACKENDS.join(", ")} (got "${raw}"). ` +
      "Leave it unset to use the Firebase project configured in .env.",
  );
}

/** The backend this page load is running against. */
export const devBackend: DevBackend = resolveDevBackend();

/** True when the Firebase SDK must not be loaded at all. */
export const isMockBackend = devBackend === "mock";

/** Placeholder Firebase credentials for the backends that never authenticate. */
export function placeholderFirebaseConfig(backend: DevBackend = devBackend): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  /**
   * The emulator's default bucket, where a personal pack's audio goes (#282).
   * `manifest.ts` reads `VITE_FIREBASE_STORAGE_BUCKET` itself, not this, so the
   * factory library keeps its same-origin delivery in emulator mode.
   */
  storageBucket: string;
} | null {
  if (backend === "project") return null;
  const projectId = backend === "emulator" ? EMULATOR_PROJECT_ID : "mock-project";
  return {
    apiKey: `${projectId}-api-key`,
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: `${projectId}-app-id`,
    storageBucket: `${projectId}.appspot.com`,
  };
}

/**
 * The emulator hosts to connect to, or `null` to leave the SDK pointed at the
 * real project.
 *
 * `emulator` mode implies the default hosts, which is what lets `dev:emulator`
 * be a bare command rather than a wall of env vars. `VITE_FIRESTORE_EMULATOR_HOST`
 * / `VITE_AUTH_EMULATOR_HOST` still override them, because
 * `tests/e2e/emulator/playwright.config.ts` only learns the real ports at runtime from
 * `firebase emulators:exec` and must be able to pass them through.
 *
 * Setting a host explicitly also selects emulator wiring on its own, so an
 * existing setup that sets only the hosts keeps working.
 */
export function resolveEmulatorHosts(
  env: Record<string, string | undefined> = import.meta.env,
  backend: DevBackend = devBackend,
): { firestore: string; auth: string; storage: string; functions: string } | null {
  const firestore = env.VITE_FIRESTORE_EMULATOR_HOST;
  const auth = env.VITE_AUTH_EMULATOR_HOST;
  const storage = env.VITE_STORAGE_EMULATOR_HOST;
  const functions = env.VITE_FUNCTIONS_EMULATOR_HOST;
  if (backend !== "emulator" && !firestore && !auth && !storage && !functions)
    return null;
  return {
    firestore: firestore || DEFAULT_FIRESTORE_EMULATOR_HOST,
    auth: auth || DEFAULT_AUTH_EMULATOR_HOST,
    storage: storage || DEFAULT_STORAGE_EMULATOR_HOST,
    functions: functions || DEFAULT_FUNCTIONS_EMULATOR_HOST,
  };
}

/**
 * How the Firestore SDK reaches the backend: `initializeFirestore`'s settings.
 *
 * Against the emulator the SDK long-polls instead of streaming (GRV-67). Its
 * default transport reads each listen and write stream as one long streamed
 * response, and WebKit can sit on a chunk the emulator has already sent: the
 * acknowledgement of a write reaches the browser and never reaches the page,
 * so New Project stayed disabled and the WebKit browser suite failed whichever
 * test happened to hit it. A long poll ends each response once it has
 * answered, which every browser delivers. The application never depends on
 * which transport the SDK picks, so the emulator uses the one every browser
 * can run deterministically; the real project keeps the SDK's own default.
 */
export function firestoreSettings(
  emulatorHosts: ReturnType<typeof resolveEmulatorHosts>,
): { experimentalForceLongPolling?: true } {
  return emulatorHosts ? { experimentalForceLongPolling: true } : {};
}
