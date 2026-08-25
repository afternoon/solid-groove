import { cleanup, render, screen } from "@solidjs/testing-library";
import {
  type Component,
  createSignal,
  ErrorBoundary,
  lazy,
  Show,
  Suspense,
} from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import AppErrorFallback from "./AppErrorFallback";
import FloatingTelemetryDisclosure from "./FloatingTelemetryDisclosure";
import TelemetryDisclosure from "./TelemetryDisclosure";

afterEach(() => cleanup());

/** Every disclosure currently in the document, floating or inline. */
function disclosures(container: HTMLElement) {
  return [...container.querySelectorAll(".telemetry-disclosure")];
}

/**
 * PRD `OPS-02`: the opt-out is reachable from every page, and a page never
 * carries two of it. `src/app.tsx` renders this outside its error boundary and
 * Suspense fallback, so these are the cases that decide whether the invariant
 * holds on `/` — where `LandingPage` hosts its own inline copy (`LOOP-001b`).
 */
describe("FloatingTelemetryDisclosure (PRD OPS-02)", () => {
  it("renders the opt-out on a page that has none of its own", () => {
    const { container } = render(() => <FloatingTelemetryDisclosure />);
    expect(disclosures(container)).toHaveLength(1);
  });

  it("stands down while a page renders its own inline copy", () => {
    const { container } = render(() => (
      <>
        <TelemetryDisclosure placement="inline" />
        <FloatingTelemetryDisclosure />
      </>
    ));

    const found = disclosures(container);
    expect(found).toHaveLength(1);
    expect(found[0]?.classList.contains("telemetry-disclosure-inline")).toBe(true);
    // Two would also mean two `id="telemetry-disclosure-note"` on one page.
    expect(container.querySelectorAll("#telemetry-disclosure-note")).toHaveLength(1);
  });

  it("comes back the moment that inline copy stops rendering", () => {
    const [showInline, setShowInline] = createSignal(true);
    const { container } = render(() => (
      <>
        <Show when={showInline()}>
          <TelemetryDisclosure placement="inline" />
        </Show>
        <FloatingTelemetryDisclosure />
      </>
    ));
    expect(disclosures(container)).toHaveLength(1);

    setShowInline(false);

    const found = disclosures(container);
    expect(found).toHaveLength(1);
    expect(found[0]?.classList.contains("telemetry-disclosure-inline")).toBe(false);
  });

  // The landing chunk failing, or `LandingPage` throwing, replaces the page --
  // and its footer disclosure -- with `AppErrorFallback`, which carries no
  // opt-out of its own. Suppressing the floating copy for the whole `/` route
  // would leave the visitor with no opt-out anywhere on the page.
  it("keeps the opt-out reachable when the page it deferred to has errored", () => {
    function Boom(): never {
      throw new Error("landing chunk failed");
    }
    const { container } = render(() => (
      <>
        <ErrorBoundary
          fallback={(error, reset) => (
            <AppErrorFallback
              error={error}
              reset={reset}
              area="shell"
              report={() => true}
            />
          )}
        >
          <Boom />
          <TelemetryDisclosure placement="inline" />
        </ErrorBoundary>
        <FloatingTelemetryDisclosure />
      </>
    ));

    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
    expect(disclosures(container)).toHaveLength(1);
    expect(
      screen.getByRole("checkbox", { name: /share usage and error reports/i }),
    ).toBeInTheDocument();
  });

  // Same reasoning for the window before the page's own copy has mounted: the
  // route chunk is still in flight, so nothing inline exists yet.
  it("keeps the opt-out reachable while the page is still loading", () => {
    const StillLoading = lazy<Component>(() => new Promise(() => {}));
    const { container } = render(() => (
      <>
        <Suspense fallback={<p>Loading</p>}>
          <StillLoading />
        </Suspense>
        <FloatingTelemetryDisclosure />
      </>
    ));

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(disclosures(container)).toHaveLength(1);
  });
});
