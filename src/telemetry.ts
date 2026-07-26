// Telemetry wiring (PRD `OPS-02`, `OPS-03`, ADR 0001).
//
// One place where the analytics boundary, the error-reporting boundary, and
// their vendor transports are connected to the running application. The
// boundaries themselves know nothing about when the app painted, which route
// is showing, or whether Firebase is configured; that all lives here.
//
// ## Timing (PRD section 10 performance budgets)
//
// The dashboard and editor shells must be interactive within 3 seconds.
// Monitoring must not compete with that, so:
//
// - The Sentry SDK is dynamically imported **after first paint**, never as
//   part of the initial bundle. `scripts/verify-bundle-budget.mjs` fails the
//   build if it lands in an eagerly-loaded chunk.
// - It is **not loaded at all on the marketing landing page** (ADR 0001,
//   `LOOP-001b`), which has no editing state to protect and the strictest
//   first-impression budget.
// - Analytics *is* wired on every surface including the landing page, because
//   `landing_cta_click` is measured there. Its transport is Firebase's, which
//   the app already loads.

import { analytics } from "./analytics/analytics";
import type { Surface } from "./analytics/catalog";
import { type ConsentStore, consentStore } from "./analytics/consent";
import { createFirebaseAnalyticsTransport } from "./analytics/firebaseTransport";
import type { AnalyticsTransport } from "./analytics/transport";
import { type ErrorReporter, errorReporter } from "./monitoring/errorReporting";
import { installGlobalErrorHandlers } from "./monitoring/globalHandlers";
import { RELEASE_SHA } from "./release";

export interface InitTelemetryOptions {
	surface: Surface;
	/** Overridden in tests so no test loads a vendor SDK. */
	createAnalyticsTransport?: () => AnalyticsTransport;
	/** Returns a started error sink, or `null` if monitoring is not wired. */
	startErrorSink?: (release: string) => Promise<void>;
	/** Schedules work for after first paint. */
	afterPaint?: (task: () => void) => void;
	reporter?: ErrorReporter;
	consent?: ConsentStore;
	target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export interface Telemetry {
	/** Removes global handlers and stops vendor transports. */
	dispose: () => Promise<void>;
}

/**
 * Wires telemetry for one app load. Returns a disposer.
 *
 * Safe to call before anything else renders: nothing here awaits a network
 * request, and every failure path is swallowed.
 */
export function initTelemetry(options: InitTelemetryOptions): Telemetry {
	const consent = options.consent ?? consentStore;
	const reporter = options.reporter ?? errorReporter;
	const afterPaint = options.afterPaint ?? afterFirstPaint;

	analytics.setSurface(options.surface);
	analytics.refreshInternalTraffic();

	const uninstallHandlers = installGlobalErrorHandlers({
		reporter,
		target: options.target,
	});

	// The transport is swapped in immediately; it buffers internally until the
	// vendor SDK resolves, so `app_opened` is not lost to lazy loading.
	if (consent.analyticsAllowed) {
		const createTransport =
			options.createAnalyticsTransport ?? createFirebaseAnalyticsTransport;
		try {
			analytics.setTransport(createTransport());
		} catch {
			// Leaves the no-op transport in place. Analytics fails open.
		}
	}

	let stopSink: (() => Promise<void>) | null = null;

	const shouldStartMonitoring =
		options.surface !== "landing" && consent.errorMonitoringAllowed;

	if (shouldStartMonitoring) {
		afterPaint(() => {
			void startMonitoring(reporter, options.startErrorSink).then((stop) => {
				stopSink = stop;
			});
		});
	}

	const unsubscribeConsent = consent.subscribe((state) => {
		if (!state.errorMonitoring && stopSink) {
			const stop = stopSink;
			stopSink = null;
			void stop();
		}
		if (!state.productAnalytics) {
			// The boundary already refuses to send while consent is withdrawn;
			// dropping the transport as well means nothing is buffered either.
			analytics.setTransport({ logEvent() {}, setUserProperties() {} });
		}
	});

	return {
		dispose: async () => {
			unsubscribeConsent();
			uninstallHandlers();
			if (stopSink) await stopSink();
		},
	};
}

/**
 * Loads the Sentry sink and attaches it to the reporting boundary.
 *
 * The dynamic `import()` is what keeps the SDK out of the entry chunk, so it
 * must stay inside this function rather than moving to a top-level import.
 */
async function startMonitoring(
	reporter: ErrorReporter,
	override?: (release: string) => Promise<void>,
): Promise<() => Promise<void>> {
	if (override) {
		await override(RELEASE_SHA).catch(() => {});
		return async () => {};
	}
	try {
		const { SentrySink } = await import("./monitoring/sentrySink");
		const sink = new SentrySink({ release: RELEASE_SHA });
		const started = await sink.start();
		if (!started) return async () => {};
		reporter.addSink(sink);
		return async () => {
			reporter.removeSink(sink);
			await sink.stop();
		};
	} catch {
		// A blocked or failed SDK load is expected for some sessions (ADR 0001:
		// "Ad and tracker blockers block sentry.io"). Errors still reach the GA4
		// `exception` counter, and the resulting undercount is documented.
		return async () => {};
	}
}

/**
 * Runs a task once the browser has painted and gone idle.
 *
 * Two nested `requestAnimationFrame` callbacks land after the first paint has
 * been committed; `requestIdleCallback` then waits for the main thread to be
 * free, with a timeout so a permanently busy thread does not starve it.
 */
export function afterFirstPaint(task: () => void): void {
	const run = () => {
		try {
			task();
		} catch {
			// Telemetry startup must never break the app that just painted.
		}
	};

	if (typeof requestAnimationFrame !== "function") {
		setTimeout(run, 0);
		return;
	}

	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const idle = (
				globalThis as {
					requestIdleCallback?: (
						cb: () => void,
						options?: { timeout: number },
					) => number;
				}
			).requestIdleCallback;
			if (typeof idle === "function") {
				idle(run, { timeout: 3_000 });
			} else {
				setTimeout(run, 0);
			}
		});
	});
}

/** Maps a pathname onto the surface it belongs to. */
export function surfaceForPath(pathname: string): Surface {
	if (pathname.startsWith("/projects/")) return "editor";
	if (pathname.startsWith("/dashboard")) return "dashboard";
	if (pathname === "/" || pathname === "") return "landing";
	return "dashboard";
}
