import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
// Type-only, so nothing of Firebase reaches the landing path's bundle.
import type { User } from "firebase/auth";
import { createSignal, onSettled } from "solid-js";
import { SITE_TITLE } from "../../site.config.mjs";
import { isNotOnAllowlistError, NOT_ON_ALLOWLIST_PATH } from "../access/allowlist";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { AuthService } from "../auth/authService";
import { reportError as defaultReportError } from "../monitoring/errorReporting";
import LandingPageContent, { type LandingCtaPlacement } from "./LandingPageContent";
import TelemetryDisclosure from "./TelemetryDisclosure";

/**
 * The public home page (PRD `PRJ-06`; task `LOOP-001b`, rebuilt by #1135).
 *
 * The product's front door: in three seconds it says what Groove is, who it is
 * for and what it solves, and every path leads to the request-access form. It
 * is drawn in the app's own system (`docs/design.md`), louder, and carries
 * only claims that are true today, plus the AI producer labelled with when it
 * arrives.
 *
 * This module is the page's *behaviour*: the analytics it emits, the sign-in it
 * runs, where it navigates, and whether its hero video plays. The markup and the copy live in
 * `LandingPageContent.tsx`, which has no imports of its own beyond Solid, so
 * the prerendered document shell can render the same tree without dragging any
 * of the below onto the server.
 *
 * ## Entering the app
 *
 * The alpha is invite-only (#854): guest start is retired, and only an
 * allowlisted Google address can sign in. So the page has two calls to action.
 * **Request access** is a plain link to the request-access form; this page
 * only counts the click. **Sign in** signs in with Google; a refused address
 * lands on the "not on the alpha list" page instead of an error.
 *
 * Only the sign-in path needs an identity provider, and it reaches
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
  /**
   * Whether the visitor has asked for reduced motion. Overridden in tests;
   * defaults to the `prefers-reduced-motion` media query.
   */
  prefersReducedMotion?: () => boolean;
}

/** `prefers-reduced-motion: reduce`, or `false` where it cannot be asked. */
function systemPrefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Starts the hero video, unless the visitor would rather not have motion.
 *
 * The markup never autoplays (see `LandingPageContent`), so the prerendered
 * page, a visitor with no script and a visitor with reduced motion all see the
 * poster, and none of them downloads the video (`preload="none"`). A refused
 * `play()` — a browser that blocks even muted autoplay, a data-saver mode —
 * leaves the poster up, which is the same page.
 */
function playHeroVideo(video: HTMLVideoElement, reducedMotion: boolean): void {
  if (reducedMotion) return;
  // Set as a property too: autoplay without a gesture is only allowed muted,
  // and the property is what the browser checks.
  video.muted = true;
  void video.play()?.catch(() => {});
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
   * `feature_first_use` for `landing_v2` (#1135): the first call to action a
   * visitor takes on this version of the page, of any kind. Once per browser;
   * `logFeatureFirstUse` keeps the marker.
   */
  const firstUse = () => {
    analytics.logFeatureFirstUse("landing_v2");
  };

  /**
   * PRD `OPS-02`: `landing_cta_click` "a visitor activates a landing-page call
   * to action", with where on the page it sat (#1135). The Request an invite
   * controls are plain links to the form, so this counts the activation and
   * leaves the navigation to the browser, whichever tab it opens in.
   */
  const requestAccess = (placement: LandingCtaPlacement) => {
    analytics.log("landing_cta_click", { cta_id: "request_access", placement });
    firstUse();
  };

  /** The hero's "See what's inside" anchor; the browser does the scrolling. */
  const seeInside = () => {
    analytics.log("landing_cta_click", { cta_id: "see_inside", placement: "hero" });
    firstUse();
  };

  /**
   * `landing_video_play`, once per page view (#1135). A looping video does not
   * fire `play` again as it wraps, but a browser that pauses an off-screen
   * video and resumes it does, so the page counts the first one only.
   */
  let videoPlayLogged = false;
  const heroVideoPlayed = () => {
    if (videoPlayLogged) return;
    videoPlayLogged = true;
    analytics.log("landing_video_play");
  };
  const prefersReducedMotion = props.prefersReducedMotion ?? systemPrefersReducedMotion;
  let heroVideo: HTMLVideoElement | undefined;
  // Once the page is in the document, so `play()` acts on the video a visitor
  // can see.
  onSettled(() => {
    if (heroVideo) playHeroVideo(heroVideo, prefersReducedMotion());
  });

  /**
   * The path for someone who has been invited.
   *
   * It starts by asking whether they are *already* signed in, because they
   * often are: sessions persist (`browserLocalPersistence`), so a producer who
   * signed in last week and came back to `/` still has one. Sending them
   * through the identity provider again for a session the browser already holds
   * is what #308 reports. Any session goes straight to the dashboard: a
   * registered one to their projects, and a guest session from before the
   * alpha closed (#854) to the guest's own projects, where upgrading to an
   * invited Google account is offered.
   *
   * With no session it signs in with Google. The blocking `beforeSignIn`
   * function refuses an address that is not on the alpha list, and that
   * refusal goes to the page that says so, with Request access, rather than to
   * an error.
   *
   * Reading the session here costs nothing extra: `authService` was already
   * behind a dynamic `import()` on this click, so `/` still ships no Firebase
   * to a visitor who never presses this button.
   */
  const logIn = async () => {
    if (busy()) return;
    analytics.log("landing_cta_click", { cta_id: "log_in", placement: "header" });
    firstUse();
    setBusy(true);
    setLoginError(null);
    try {
      const authService = await loadAuthService();
      const session = await restoreSession(
        authService,
        props.sessionRestoreTimeoutMs ?? SESSION_RESTORE_TIMEOUT_MS,
      );
      if (session) {
        navigate("/projects");
        return;
      }
      await authService.signInWithGoogle();
      navigate("/projects");
    } catch (error) {
      // The alpha allowlist refused the address (#854): not a failure to
      // report, an answer to show. The page it lands on says why and offers
      // Request access.
      if (isNotOnAllowlistError(error)) {
        analytics.log("sign_in_blocked", { source: "landing" });
        navigate(NOT_ON_ALLOWLIST_PATH);
        return;
      }
      // A cancelled popup is the common case and is not worth a fatal report,
      // but a broken provider looks identical from here — report it non-fatally
      // and let the visitor try again.
      reportError(error, { area: "shell", fatal: false });
      setLoginError("Could not sign in. Try again.");
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
        onRequestAccess={requestAccess}
        onLogIn={() => void logIn()}
        onSeeInside={seeInside}
        heroVideoRef={(video) => {
          heroVideo = video;
        }}
        onHeroVideoPlay={heroVideoPlayed}
        disclosure={<TelemetryDisclosure placement="inline" />}
      />
    </>
  );
}
