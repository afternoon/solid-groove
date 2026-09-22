import { useNavigate } from "@solidjs/router";
import { createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { AuthService } from "../auth/authService";
import { reportError as defaultReportError } from "../monitoring/errorReporting";
import LandingPageContent from "./LandingPageContent";
import TelemetryDisclosure from "./TelemetryDisclosure";

/**
 * The public marketing landing page (PRD `PRJ-06`, task `LOOP-001b`).
 *
 * The product's front door, and the entry point into the PRJ-01 anonymous
 * start. Design reference: `docs/design/mocks/04-landing-page.png`. The mock is
 * directional — it shows a full marketing site with a tour, pricing, and
 * capabilities the alpha has not built — so this page keeps the mock's
 * structure and visual language and carries only claims that are true today.
 *
 * This module is the page's *behaviour*: the analytics it emits, the sign-in it
 * runs, and where it navigates. The markup and the copy live in
 * `LandingPageContent.tsx`, which has no imports of its own beyond Solid, so
 * the prerendered document shell can render the same tree without dragging any
 * of the below onto the server.
 *
 * ## Entering the app
 *
 * The primary call to action navigates to the dashboard and lets `AuthProvider`
 * run the PRJ-01 anonymous start — it deliberately does *not* sign in here.
 * That keeps one anonymous-start path in the product rather than two, and it is
 * what makes `anon_session_created` fire for a visitor who arrives through this
 * page: the event belongs to the provider that creates the session, and a
 * landing page that signed in first would silence it.
 *
 * Only the "Log in" path needs an identity provider, and it reaches
 * `authService` through a dynamic `import()` on click. Nothing about a visitor
 * who never clicks should pay for the Firebase SDK: this is the surface with
 * the strictest first-impression budget and no editing state to protect (see
 * the same reasoning for the monitoring SDK in `src/telemetry.ts`).
 */
export interface LandingPageProps {
  /** Overridden in tests; defaults to the app-wide analytics boundary. */
  analytics?: Analytics;
  /** Overridden in tests; defaults to the dynamically imported auth service. */
  loadAuthService?: () => Promise<Pick<AuthService, "signInWithGoogle">>;
  /** Overridden in tests; defaults to the app-wide reporting boundary. */
  reportError?: typeof defaultReportError;
}

export default function LandingPage(props: LandingPageProps) {
  const analytics = props.analytics ?? defaultAnalytics;
  const loadAuthService =
    props.loadAuthService ??
    (() => import("../auth/authService").then((module) => module.authService));
  const reportError = props.reportError ?? defaultReportError;
  const [busy, setBusy] = createSignal(false);
  const [loginError, setLoginError] = createSignal<string | null>(null);
  const navigate = useNavigate();

  /**
   * PRD `OPS-02`: `landing_cta_click` "a visitor activates a landing-page call
   * to action". Logged once per activation, before the path it starts, so a
   * failing sign-in still counts the intent.
   */
  const startFree = () => {
    if (busy()) return;
    analytics.log("landing_cta_click", { cta_id: "start_free" });
    navigate("/dashboard");
  };

  /**
   * The path for someone who already has an account.
   *
   * It signs in, and signing in with Google is *not* the same as upgrading a
   * guest session: Firebase does not auto-link, so it swaps the uid and leaves
   * any projects made in this browser as a guest owned by the anonymous one.
   * `authService.linkWithGoogle` is the operation that keeps the `DEC-001`
   * retention promise, and it lives behind the dashboard's
   * `UpgradeAccountPrompt`, where there is a known signed-in guest to link.
   *
   * So this page states the promise against that control rather than this
   * button (see the note in the "Where the alpha is today" section), and says
   * plainly what logging in here does instead. Teaching this button to link —
   * which means resolving the current session first, and deciding what happens
   * when the Google account already exists — is the account-linking task's
   * call, not the landing page's.
   */
  const logIn = async () => {
    if (busy()) return;
    analytics.log("landing_cta_click", { cta_id: "log_in" });
    setBusy(true);
    setLoginError(null);
    try {
      const authService = await loadAuthService();
      await authService.signInWithGoogle();
      navigate("/dashboard");
    } catch (error) {
      // A cancelled popup is the common case and is not worth a fatal report,
      // but a broken provider looks identical from here — report it non-fatally
      // and let the visitor try again or start as a guest instead.
      reportError(error, { area: "shell", fatal: false });
      setLoginError("Could not log in. Try again, or start free without an account.");
      setBusy(false);
    }
  };

  return (
    <LandingPageContent
      busy={busy()}
      loginError={loginError()}
      onStartFree={startFree}
      onLogIn={() => void logIn()}
      disclosure={<TelemetryDisclosure placement="inline" />}
    />
  );
}
