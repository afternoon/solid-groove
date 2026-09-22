import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
// Type-only, so nothing of Firebase reaches the landing path's bundle.
import type { User } from "firebase/auth";
import { createSignal } from "solid-js";
import { SITE_TITLE } from "../../site.config.mjs";
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
  loadAuthService?: () => Promise<
    Pick<AuthService, "signInWithGoogle" | "onAuthStateChanged">
  >;
  /** Overridden in tests; defaults to the app-wide reporting boundary. */
  reportError?: typeof defaultReportError;
  /**
   * How long to wait for the persisted session to restore before giving up on
   * it and signing in instead (see {@link restoreSession}). Overridden in tests
   * so the fallback can be proven without waiting out the real budget.
   */
  sessionRestoreTimeoutMs?: number;
}

/**
 * How long a persisted session gets to restore before the click falls back to
 * signing in. Long enough for an IndexedDB read behind a freshly imported SDK,
 * short enough that a visitor whose session never resolves gets the provider
 * rather than a button stuck on "Logging in…".
 */
const SESSION_RESTORE_TIMEOUT_MS = 3_000;

/**
 * The session the auth service restores, or `null` if there is none — or if it
 * does not arrive within `timeoutMs`.
 *
 * `getCurrentUser()` is not the read to use here: it returns
 * `auth.currentUser`, which is `null` immediately after the dynamic import
 * because restoring the persisted session is asynchronous, so it would report
 * "no session" for exactly the returning visitor this page has to recognise.
 * The first `onAuthStateChanged` emission is the restored state. Subscribing is
 * a read and creates nothing: it is `AuthProvider`'s no-user branch, not the
 * subscription, that mints an anonymous session.
 */
function restoreSession(
  auth: Pick<AuthService, "onAuthStateChanged">,
  timeoutMs: number,
): Promise<User | null> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    const settle = (user: User | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(user);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    unsubscribe = auth.onAuthStateChanged(settle);
    // A service that emits synchronously settles before `unsubscribe` is
    // assigned above, so the teardown happens here instead of leaking.
    if (settled) unsubscribe();
  });
}

/**
 * Whether a click on a link asks for it to be opened somewhere other than this
 * tab, in which case intercepting it would take away what the visitor asked
 * for. `button !== 0` covers a middle-click, which fires `click` in Chromium
 * with `auxclick` semantics elsewhere; the modifier keys cover the rest.
 */
function opensElsewhere(event: MouseEvent): boolean {
  return (
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  );
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
   *
   * The control is an anchor pointing at `/dashboard` (see `START_HREF` in
   * `LandingPageContent`), so this handler's job is to *upgrade* a click that
   * the browser would otherwise serve as a full page load. It takes the click
   * only when it is the plain left-click that means "go there in this tab":
   *
   * - A modified click (new tab, new window, download, or a non-primary
   *   button) is left to the browser, which is the whole point of having a
   *   real `href`. The activation is still counted -- the visitor did choose
   *   the call to action -- but this tab does not navigate.
   * - While a sign-in is in flight the page is busy, so the click is
   *   cancelled outright rather than racing the popup it would abandon.
   */
  const startFree = (event: MouseEvent) => {
    if (busy()) {
      event.preventDefault();
      return;
    }
    analytics.log("landing_cta_click", { cta_id: "start_free" });
    if (opensElsewhere(event)) return;
    event.preventDefault();
    navigate("/dashboard");
  };

  /**
   * The path for someone who already has an account.
   *
   * It starts by asking whether they are *already* signed in, because they
   * often are: sessions persist (`browserLocalPersistence`), so a visitor who
   * logged in last week and came back to `/` still has one. Sending them
   * through the identity provider again for a session the browser already holds
   * is what #308 reports. A registered session goes straight to the dashboard;
   * a guest session or none at all signs in exactly as before, since logging in
   * over a guest is a real sign-in (see the uid-swap note below).
   *
   * Reading the session here costs nothing extra: `authService` was already
   * behind a dynamic `import()` on this click, so `/` still ships no Firebase
   * to a visitor who never presses this button.
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
      const session = await restoreSession(
        authService,
        props.sessionRestoreTimeoutMs ?? SESSION_RESTORE_TIMEOUT_MS,
      );
      if (session && !session.isAnonymous) {
        navigate("/dashboard");
        return;
      }
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
    <>
      {/* The shell's prerendered `<title>` says this (`src/Document.tsx`), and
          the app's default says "Groove". Without this the two would disagree
          the moment the client mounts, and a crawler that executes JavaScript
          would index the wrong one. */}
      <Title>{SITE_TITLE}</Title>
      <LandingPageContent
        busy={busy()}
        loginError={loginError()}
        onStartFree={startFree}
        onLogIn={() => void logIn()}
        disclosure={<TelemetryDisclosure placement="inline" />}
      />
    </>
  );
}
