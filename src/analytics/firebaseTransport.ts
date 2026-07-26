// The Google Analytics for Firebase transport (PRD 9.1, `OPS-02`).
//
// The only module that imports `firebase/analytics`. Like
// `firestoreProjectRepository.ts` in the persistence layer and
// `sentrySink.ts` in monitoring, it is deliberately not re-exported from this
// directory's barrel: the boundary in `analytics.ts` is what application code
// uses, and swapping vendors must not mean touching call sites.
//
// PRD `OPS-02` also notes what is *not* here: "Sessions, first opens, page
// views, and engagement time come from Google Analytics automatic collection
// and are not re-implemented as custom events."

import type { AnalyticsParamValue } from "./catalog";
import type { AnalyticsTransport } from "./transport";

type FirebaseAnalytics = import("firebase/analytics").Analytics;

/** Events buffered while the SDK resolves. */
const MAX_BUFFERED = 20;

interface BufferedEvent {
	readonly name: string;
	readonly params: Readonly<Record<string, AnalyticsParamValue>>;
}

export interface FirebaseTransportOptions {
	/** Resolves the initialized Analytics instance, or `null` if unsupported. */
	load?: () => Promise<FirebaseAnalytics | null>;
}

/**
 * Creates the Firebase transport.
 *
 * Returns synchronously and buffers until the SDK resolves, so the app never
 * waits on analytics and an early `app_opened` is not lost. Every failure
 * path — unsupported environment, missing `measurementId`, a blocked request —
 * degrades to discarding events, never to throwing (PRD `OPS-02` fail-open).
 */
export function createFirebaseAnalyticsTransport(
	options: FirebaseTransportOptions = {},
): AnalyticsTransport {
	let instance: FirebaseAnalytics | null = null;
	let unavailable = false;
	const bufferedEvents: BufferedEvent[] = [];
	let bufferedProperties: Record<string, string> | null = null;

	const load =
		options.load ??
		(async () => {
			const { analytics } = await import("../firebaseConfig");
			return analytics;
		});

	const ready = load()
		.then(async (resolved) => {
			if (!resolved) {
				unavailable = true;
				bufferedEvents.length = 0;
				bufferedProperties = null;
				return;
			}
			instance = resolved;
			const sdk = await import("firebase/analytics");
			if (bufferedProperties) {
				sdk.setUserProperties(resolved, bufferedProperties);
				bufferedProperties = null;
			}
			for (const event of bufferedEvents.splice(0, bufferedEvents.length)) {
				sdk.logEvent(resolved, event.name, event.params);
			}
		})
		.catch(() => {
			unavailable = true;
			bufferedEvents.length = 0;
			bufferedProperties = null;
		});

	return {
		logEvent(name, params) {
			if (unavailable) return;
			if (!instance) {
				if (bufferedEvents.length < MAX_BUFFERED) {
					bufferedEvents.push({ name, params });
				}
				return;
			}
			void ready.then(async () => {
				try {
					const sdk = await import("firebase/analytics");
					if (instance) sdk.logEvent(instance, name, params);
				} catch {
					// Blocked by an extension, offline, or the SDK failed to load.
				}
			});
		},
		setUserProperties(properties) {
			if (unavailable) return;
			if (!instance) {
				bufferedProperties = { ...bufferedProperties, ...properties };
				return;
			}
			void ready.then(async () => {
				try {
					const sdk = await import("firebase/analytics");
					if (instance) sdk.setUserProperties(instance, properties);
				} catch {
					// Same as above: never surfaces.
				}
			});
		},
	};
}
