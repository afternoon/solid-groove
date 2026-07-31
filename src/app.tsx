import { MetaProvider, Title } from "@solidjs/meta";
import { Router, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import {
	type Accessor,
	createEffect,
	createSignal,
	ErrorBoundary,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { analytics } from "./analytics/analytics";
import AppErrorFallback from "./components/AppErrorFallback";
import ReleaseBadge from "./components/ReleaseBadge";
import TapeLoader from "./components/TapeLoader";
import TelemetryDisclosure from "./components/TelemetryDisclosure";
import { syncInternalTraffic } from "./shared/internalTraffic";
import { initTelemetry, surfaceForPath, type Telemetry } from "./telemetry";
import "./app.css";

/**
 * Keeps telemetry in step with the route (PRD `OPS-02`: "Every event carries
 * ... the surface it came from"). Rendered inside the Router so it can observe
 * navigation; it renders nothing itself.
 *
 * Navigation off the landing page is client-side — the CTA calls
 * `navigate("/dashboard")` with no page load — so this is also where monitoring
 * starts and `app_opened` fires for a session that entered on `/`. Handing the
 * surface to `Telemetry` rather than to `analytics` directly is what makes that
 * one decision instead of three.
 *
 * The effect reads the telemetry accessor, so it re-runs with the current
 * pathname once `initTelemetry` has finished; until then the surface still
 * reaches the analytics boundary directly and nothing is lost to mount order.
 */
function SurfaceTracker(props: { telemetry: Accessor<Telemetry | null> }) {
	const location = useLocation();
	createEffect(() => {
		const surface = surfaceForPath(location.pathname);
		const telemetry = props.telemetry();
		if (telemetry) {
			telemetry.setSurface(surface);
		} else {
			analytics.setSurface(surface);
		}
	});
	return null;
}

/**
 * The app-chrome copy of the PRD `OPS-02` disclosure and opt-out.
 *
 * Rendered on every surface except the landing page, which carries its own in
 * its footer (`LOOP-001b`). Two on one page would mean two controls for one
 * preference and duplicate element ids.
 */
function FloatingTelemetryDisclosure() {
	const location = useLocation();
	return (
		<Show when={surfaceForPath(location.pathname) !== "landing"}>
			<TelemetryDisclosure />
		</Show>
	);
}

export default function App() {
	const [telemetry, setTelemetry] = createSignal<Telemetry | null>(null);

	// PRD `OPS-01`: mark internal/team traffic once per app load so it can be
	// excluded from the section 11 measures. Outside the Router's `root` render
	// prop so it runs once regardless of which route was entered, not once per
	// navigation.
	onMount(() => {
		syncInternalTraffic();

		// PRD `OPS-02`/`OPS-03`: install the global error handlers and the
		// analytics transport. Monitoring itself is scheduled by `setSurface`,
		// which the tracker above drives, so a session that starts on the
		// marketing landing page and navigates into the app is still monitored
		// while one that stays on the landing page loads no SDK (ADR 0001).
		const instance = initTelemetry({
			surface: surfaceForPath(window.location.pathname),
		});
		setTelemetry(() => instance);

		onCleanup(() => {
			void instance.dispose();
		});
	});

	return (
		<Router
			root={(props) => (
				<MetaProvider>
					<Title>Groove</Title>
					<SurfaceTracker telemetry={telemetry} />
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
					    reachable even on the error screen. The landing page renders its
					    own inline copy in its footer (`LOOP-001b`, per DEC-009), so the
					    floating one stands down there rather than duplicating it. */}
					<FloatingTelemetryDisclosure />
				</MetaProvider>
			)}
		>
			<FileRoutes />
		</Router>
	);
}
