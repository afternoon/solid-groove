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
//
// ## Consent governs collection, on every path
//
// Consent is not a single check at startup. It is re-consulted wherever
// collection could begin or resume, because all three of these happen after
// `initTelemetry` returns:
//
// - **The vendor SDK.** Google Analytics collects `page_view`, `session_start`,
//   `first_visit`, and `user_engagement` automatically the moment gtag is
//   bootstrapped, regardless of which transport this module holds. So the
//   opt-out reaches the SDK itself (`setVendorAnalyticsCollection`), and a
//   declined session never initializes it at all — see `src/firebaseConfig.ts`.
// - **The surface.** Navigation off the landing page is client-side, so
//   `surfaceForPath(window.location.pathname)` at mount is not the surface the
//   session ends up on. Monitoring and `app_opened` are driven by `setSurface`,
//   which the router calls on every navigation.
// - **The direction of the toggle.** Withdrawal tears collection down and a
//   later grant rebuilds it. A one-way switch leaves a user who changes their
//   mind uncollected with the checkbox showing "on".

import { analytics } from "./analytics/analytics";
import type { Surface } from "./analytics/catalog";
import { type ConsentStore, consentStore } from "./analytics/consent";
import {
	createFirebaseAnalyticsTransport,
	setFirebaseAnalyticsCollectionEnabled,
} from "./analytics/firebaseTransport";
import { type AnalyticsTransport, noopTransport } from "./analytics/transport";
import { type ErrorReporter, errorReporter } from "./monitoring/errorReporting";
import { installGlobalErrorHandlers } from "./monitoring/globalHandlers";
import { RELEASE_SHA } from "./release";

export interface InitTelemetryOptions {
	/** The surface the app load entered on. */
	surface: Surface;
	/** Overridden in tests so no test loads a vendor SDK. */
	createAnalyticsTransport?: () => AnalyticsTransport;
	/**
	 * Switches the vendor analytics SDK's own automatic collection on and off.
	 * Overridden in tests so no test bootstraps gtag.
	 */
	setVendorAnalyticsCollection?: (enabled: boolean) => void;
	/**
	 * Starts the error sink in place of the real dynamic import. May resolve to
	 * a stopper, which lets a test observe that a sink started during a consent
	 * withdrawal is stopped again.
	 */
	startErrorSink?: StartErrorSink;
	/** Schedules work for after first paint. */
	afterPaint?: (task: () => void) => void;
	reporter?: ErrorReporter;
	consent?: ConsentStore;
	target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export interface Telemetry {
	/**
	 * Records the surface the app is showing now, including after a client-side
	 * navigation. Reaching a non-landing surface is what starts monitoring and
	 * fires `app_opened`.
	 */
	setSurface: (surface: Surface) => void;
	/**
	 * Starts error monitoring if consent allows, a monitored surface has been
	 * reached, and it is not already running or starting. Idempotent, so the
	 * router and the consent subscription can both call it freely.
	 */
	startMonitoringIfAllowed: () => void;
	/** Removes global handlers and stops vendor transports. */
	dispose: () => Promise<void>;
}

/** Detaches a started error sink and shuts its vendor transport down. */
export type StopErrorSink = () => Promise<void>;

/** A test's stand-in for the real dynamic import, optionally returning a stopper. */
export type StartErrorSink = (
	release: string,
) => Promise<void> | Promise<StopErrorSink>;

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
	const createTransport =
		options.createAnalyticsTransport ?? createFirebaseAnalyticsTransport;
	const setVendorCollection =
		options.setVendorAnalyticsCollection ??
		setFirebaseAnalyticsCollectionEnabled;

	analytics.refreshInternalTraffic();

	const uninstallHandlers = installGlobalErrorHandlers({
		reporter,
		target: options.target,
	});

	/** Whether a monitored (non-landing) surface has been reached this load. */
	let monitoredSurfaceReached = false;
	let appOpenedLogged = false;
	/** The running sink's stopper, or `null` when nothing is attached. */
	let stopSink: StopErrorSink | null = null;
	/** A start is scheduled or in flight, so `stopSink` is not yet meaningful. */
	let sinkStarting = false;
	let disposed = false;

	/**
	 * Attaches the sink, re-checking consent and disposal once it has resolved.
	 *
	 * The start lands two animation frames plus an idle callback after it was
	 * scheduled, and `TelemetryDisclosure` is reachable throughout. Neither the
	 * consent subscription nor `dispose` can see a sink during that window —
	 * `stopSink` is still null — so this is the only place that can stop one
	 * that arrives too late. Without it, `sentry.init()` and its Release Health
	 * session envelope stay attached for a user who has already declined or for
	 * a page that has already torn telemetry down.
	 */
	const attachSink = async (): Promise<void> => {
		try {
			const stop = await startMonitoring(reporter, options.startErrorSink);
			if (disposed || !consent.errorMonitoringAllowed) {
				void stop();
				return;
			}
			stopSink = stop;
		} finally {
			sinkStarting = false;
		}
	};

	const startMonitoringIfAllowed = (): void => {
		if (disposed || !monitoredSurfaceReached) return;
		if (stopSink !== null || sinkStarting) return;
		if (!consent.errorMonitoringAllowed) return;
		sinkStarting = true;
		afterPaint(() => {
			if (disposed || !consent.errorMonitoringAllowed) {
				sinkStarting = false;
				return;
			}
			void attachSink();
		});
	};

	const setSurface = (surface: Surface): void => {
		// After `dispose` the wiring is gone; a late navigation must not resurrect
		// `app_opened` or a monitoring start the disposer has no handle on.
		if (disposed) return;
		analytics.setSurface(surface);
		// ADR 0001: the marketing landing page loads no monitoring SDK, and
		// `app_opened` is not its event — `landing_cta_click` is.
		if (surface === "landing") return;
		monitoredSurfaceReached = true;
		if (!appOpenedLogged) {
			// PRD `OPS-02`: `app_opened` fires when "the editor or dashboard shell
			// becomes interactive". That is reaching a non-landing surface, whether
			// the session deep-linked into it or was client-navigated there. Once
			// per app load rather than per navigation: GA4 automatic collection
			// already counts sessions and page views.
			appOpenedLogged = true;
			analytics.log("app_opened");
		}
		startMonitoringIfAllowed();
	};

	// Delivered synchronously on subscribe, which is what wires the initial
	// state, and again on every change. Symmetric in both directions: a grant
	// rebuilds exactly what a withdrawal tore down.
	const unsubscribeConsent = consent.subscribe((state) => {
		if (state.errorMonitoring) {
			startMonitoringIfAllowed();
		} else if (stopSink) {
			const stop = stopSink;
			stopSink = null;
			void stop();
		}

		if (state.productAnalytics) {
			setVendorCollection(true);
			// The transport is swapped in synchronously; it buffers internally until
			// the vendor SDK resolves, so `app_opened` is not lost to lazy loading.
			try {
				analytics.setTransport(createTransport());
			} catch {
				// Leaves the previous transport in place. Analytics fails open.
			}
		} else {
			// The boundary already refuses to send while consent is withdrawn;
			// dropping the transport as well means nothing is buffered either, and
			// disabling the SDK stops the automatic collection no transport controls.
			analytics.setTransport(noopTransport);
			setVendorCollection(false);
		}
	});

	// Last, so the transport above is already attached when `app_opened` fires.
	setSurface(options.surface);

	return {
		setSurface,
		startMonitoringIfAllowed,
		dispose: async () => {
			disposed = true;
			unsubscribeConsent();
			uninstallHandlers();
			const stop = stopSink;
			stopSink = null;
			if (stop) await stop();
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
	override?: StartErrorSink,
): Promise<StopErrorSink> {
	if (override) {
		const stop = await override(RELEASE_SHA).catch(() => undefined);
		return typeof stop === "function" ? stop : async () => {};
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
