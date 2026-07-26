import { MetaProvider, Title } from "@solidjs/meta";
import { Router, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createEffect, ErrorBoundary, onCleanup, onMount, Suspense } from "solid-js";
import { analytics } from "./analytics/analytics";
import AppErrorFallback from "./components/AppErrorFallback";
import ReleaseBadge from "./components/ReleaseBadge";
import TapeLoader from "./components/TapeLoader";
import TelemetryDisclosure from "./components/TelemetryDisclosure";
import { syncInternalTraffic } from "./shared/internalTraffic";
import { initTelemetry, surfaceForPath } from "./telemetry";
import "./app.css";

/**
 * Keeps the analytics surface in step with the route (PRD `OPS-02`: "Every
 * event carries ... the surface it came from"). Rendered inside the Router so
 * it can observe navigation; it renders nothing itself.
 */
function SurfaceTracker() {
	const location = useLocation();
	createEffect(() => {
		analytics.setSurface(surfaceForPath(location.pathname));
	});
	return null;
}

export default function App() {
	// PRD `OPS-01`: mark internal/team traffic once per app load so it can be
	// excluded from the section 11 measures. Outside the Router's `root` render
	// prop so it runs once regardless of which route was entered, not once per
	// navigation.
	onMount(() => {
		syncInternalTraffic();

		// PRD `OPS-02`/`OPS-03`: install the global error handlers and the
		// analytics transport, and schedule the lazy Sentry load for after first
		// paint. The initial surface decides whether monitoring loads at all —
		// the marketing landing page never loads it (ADR 0001).
		const surface = surfaceForPath(window.location.pathname);
		const telemetry = initTelemetry({ surface });

		// `app_opened` fires when "the editor or dashboard shell becomes
		// interactive" (PRD `OPS-02`). The landing page is neither; its own
		// measurement is `landing_cta_click`, shipped by `LOOP-001b`. GA4
		// automatic collection already counts sessions and page views, so this is
		// once per app load rather than once per navigation.
		if (surface !== "landing") {
			analytics.log("app_opened");
		}

		onCleanup(() => {
			void telemetry.dispose();
		});
	});

	return (
		<Router
			root={(props) => (
				<MetaProvider>
					<Title>Groove</Title>
					<SurfaceTracker />
					<ErrorBoundary
						fallback={(err, reset) => (
							<AppErrorFallback error={err} reset={reset} area="shell" />
						)}
					>
						<Suspense fallback={<TapeLoader label="Loading" />}>
							{props.children}
						</Suspense>
					</ErrorBoundary>
					{/* Outside the ErrorBoundary/Suspense so the deployed revision
					    stays visible/inspectable even while the app is loading or has
					    hit an error -- exactly when knowing the build matters most. */}
					<ReleaseBadge />
					{/* Also outside the boundary: the PRD OPS-02 opt-out must stay
					    reachable even on the error screen. */}
					<TelemetryDisclosure />
				</MetaProvider>
			)}
		>
			<FileRoutes />
		</Router>
	);
}
