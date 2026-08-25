import {
  type Analytics,
  getAnalytics,
  isSupported,
  setAnalyticsCollectionEnabled,
} from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { placeholderFirebaseConfig, resolveEmulatorHosts } from "./devBackend";

// Placeholder credentials for the two backends that do not authenticate
// against a real project: the mock backend never loads the SDK at all, and the
// emulator validates none of them. Falling back keeps `initializeApp`
// succeeding so neither mode needs a configured `.env`. The emulator's
// `projectId` is load-bearing rather than cosmetic — see `src/devBackend.ts`.
const placeholders = placeholderFirebaseConfig();

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? placeholders?.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? placeholders?.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? placeholders?.projectId,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? placeholders?.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local Firebase Emulator wiring (`VITE_DEV_BACKEND=emulator`, plus the
// `FND-009` emulator-backed browser E2E suite; see
// `tests/e2e/emulator/playwright.config.ts`). Distinct from the mock backend, which swaps
// in an in-memory fake and never touches the Firebase SDK at all: this points
// the *real* SDK at a local emulator so a genuine page reload proves
// persistence rather than a fake that resets on every navigation. Emulator mode
// implies the default hosts and `VITE_*_EMULATOR_HOST` overrides them — see
// `src/devBackend.ts`. Dev/test only; never set in a real deployment.
const emulatorHosts = resolveEmulatorHosts();
if (emulatorHosts) {
  const [firestoreHost, firestorePort] = emulatorHosts.firestore.split(":");
  connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
  connectAuthEmulator(auth, `http://${emulatorHosts.auth}`, {
    disableWarnings: true,
  });
}

// Google Analytics (PRD `OPS-02`).
//
// Deliberately *not* initialized at module evaluation. `getAnalytics(app)`
// bootstraps gtag, and gtag immediately begins GA4 automatic collection —
// `page_view`, `session_start`, `first_visit`, `user_engagement`, and the `_ga`
// cookies — which `OPS-02` counts as collection just as much as a custom event
// does. This module is imported for `auth` and `db` on every app load, so
// initializing here would collect for a user who has opted out, before consent
// had ever been consulted, and the disclosure's "turning this off stops
// collection" would be false.
//
// `src/telemetry.ts` is the only caller, and it calls in only once the consent
// store says analytics is allowed.

/** Memoized so gtag is bootstrapped at most once per page. */
let analyticsInstance: Promise<Analytics | null> | null = null;

/**
 * Initializes Google Analytics, or resolves `null` where it cannot run.
 *
 * Analytics is optional and only works in supported environments with a valid
 * `measurementId`, so every failure path resolves `null` rather than throwing:
 * running without Firebase env vars configured must not break app startup.
 */
export function loadAnalytics(): Promise<Analytics | null> {
  analyticsInstance ??= isSupported()
    .then((supported) =>
      supported && firebaseConfig.measurementId ? getAnalytics(app) : null,
    )
    .catch(() => null);
  return analyticsInstance;
}

/**
 * Applies a consent decision to the vendor SDK itself (PRD `OPS-02` opt-out).
 *
 * Switching collection *off* never initializes: if `loadAnalytics` has not been
 * called there is nothing collecting, and bootstrapping gtag in order to
 * disable it would perform the exact automatic collection the opt-out exists to
 * prevent.
 *
 * Never rejects. A consent preference is not a reason for the app to fail.
 */
export async function setAnalyticsCollection(enabled: boolean): Promise<void> {
  if (!enabled && analyticsInstance === null) return;
  try {
    const instance = await loadAnalytics();
    if (instance) setAnalyticsCollectionEnabled(instance, enabled);
  } catch {
    // Unsupported environment, blocked SDK, or no measurementId. Collection
    // that never started needs no switching off.
  }
}
