import {
	type Analytics,
	getAnalytics,
	isSupported,
	setAnalyticsCollectionEnabled,
} from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// In mock mode the app talks to the in-memory mock services rather than real
// Firebase, so we don't need real credentials. Fall back to harmless
// placeholder values so `initializeApp` succeeds and the UI can render without
// a configured .env.
const isMock = import.meta.env.VITE_MOCK_BACKEND === "true";

const firebaseConfig = {
	apiKey:
		import.meta.env.VITE_FIREBASE_API_KEY ??
		(isMock ? "mock-api-key" : undefined),
	authDomain:
		import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
		(isMock ? "mock.firebaseapp.com" : undefined),
	projectId:
		import.meta.env.VITE_FIREBASE_PROJECT_ID ??
		(isMock ? "mock-project" : undefined),
	databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId:
		import.meta.env.VITE_FIREBASE_APP_ID ??
		(isMock ? "mock-app-id" : undefined),
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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
