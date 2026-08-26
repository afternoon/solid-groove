import { Title } from "@solidjs/meta";
import { useLocation } from "@solidjs/router";
import { Errored, Loading } from "@solidjs/web";
import { type Accessor, createEffect, createSignal, onSettled } from "solid-js";
import { analytics } from "./analytics/analytics";
import AppErrorFallback from "./components/AppErrorFallback";
import FloatingTelemetryDisclosure from "./components/FloatingTelemetryDisclosure";
import ReleaseBadge from "./components/ReleaseBadge";
import TapeLoader from "./components/TapeLoader";
import { Router } from "./router";
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
 * The compute phase reads both the pathname and the telemetry accessor, so the
 * effect re-runs with the current pathname once `initTelemetry` has finished;
 * until then the surface still reaches the analytics boundary directly and
 * nothing is lost to mount order. Both reads must stay in the compute half:
 * Solid 2 only tracks what the compute function touches, so a read moved into
 * the apply half below would silently stop the effect reacting to it.
 */
function SurfaceTracker(props: { telemetry: Accessor<Telemetry | null> }) {
  const location = useLocation();
  createEffect(
    () => ({
      surface: surfaceForPath(location.pathname),
      telemetry: props.telemetry(),
    }),
    ({ surface, telemetry }) => {
      if (telemetry) {
        telemetry.setSurface(surface);
      } else {
        analytics.setSurface(surface);
      }
    },
  );
  return null;
}

export default function App() {
  const [telemetry, setTelemetry] = createSignal<Telemetry | null>(null);

  // PRD `OPS-01`: mark internal/team traffic once per app load so it can be
  // excluded from the section 11 measures. Outside the Router's layout render
  // prop so it runs once regardless of which route was entered, not once per
  // navigation.
  //
  // `onSettled` rather than 1.x's `onMount`, and the teardown is the returned
  // cleanup rather than a nested `onCleanup` — in Solid 2 that nesting is no
  // longer the idiom, and the returned function is what the lifecycle actually
  // honours.
  onSettled(() => {
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

    return () => {
      void instance.dispose();
    };
  });

  return (
    <Router>
      {(props) => (
        <>
          <Title>Groove</Title>
          <SurfaceTracker telemetry={telemetry} />
          <Errored
            fallback={(err, reset) => (
              <AppErrorFallback error={err()} reset={reset} area="shell" />
            )}
          >
            <Loading fallback={<TapeLoader label="Loading" />}>
              {props.children}
            </Loading>
          </Errored>
          {/* Outside the Errored/Loading boundary so the deployed revision
					    stays visible/inspectable even while the app is loading or has
					    hit an error -- exactly when knowing the build matters most. */}
          <ReleaseBadge />
          {/* Also outside the boundary: the PRD OPS-02 opt-out must stay
					    reachable even on the error screen -- which is why this stands
					    down for the landing page's own inline copy (`LOOP-001b`, per
					    DEC-009) only while that copy is actually mounted, rather than
					    for the whole route. */}
          <FloatingTelemetryDisclosure />
        </>
      )}
    </Router>
  );
}
