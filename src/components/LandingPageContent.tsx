import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import "./LandingPage.css";

/**
 * The landing page's markup and copy, with no behaviour of its own.
 *
 * Split out of `LandingPage.tsx` so the same tree can be rendered from two
 * places: the interactive page the client mounts, and the prerendered document
 * shell (`src/Document.tsx`), which is SSR-transformed at build time. Keeping
 * it props-only is what makes the second one possible — the shell must not
 * reach the analytics, auth, or consent module graphs, and this component
 * imports none of them.
 *
 * It is also the single copy of the copy: a claim edited here changes the
 * prerendered HTML and the live page together, so the two can never drift.
 *
 * ## Honesty is a requirement here, not a tone
 *
 * `PRJ-06`: the page "does not advertise capabilities beyond the current
 * milestone". `WHAT_WORKS_TODAY` and `WHAT_IS_BEING_BUILT` below are the two
 * lists that make that checkable rather than a matter of taste, and they are
 * the part of this file that goes stale: a task that ships one of the "being
 * built" capabilities moves its line across. Nothing else on the page names a
 * feature, so nothing else has to be revisited.
 */

/** Shipped and reachable in the alpha today. */
const WHAT_WORKS_TODAY = [
  "Start with no account and keep your projects in the browser.",
  "A sampler track with a 16-step sequencer you can play back.",
  "Every edit runs through undo and redo.",
  "Projects save as you work and are there when you come back.",
];

/** Named so the page is honest about the gap, in build order. */
const WHAT_IS_BEING_BUILT = [
  "The AI producer that proposes editable changes.",
  "The arrangement timeline and song sections.",
  "The sound library and its packs.",
  "WAV and stem export.",
];

/**
 * Browsers the alpha is tested in (PRD section 10, "Supported environment").
 * Chrome, Edge, and Firefox gate the release; Safari is best-effort and is
 * described as such rather than listed alongside them.
 */
const GATING_BROWSERS = "Chrome, Edge and Firefox";

/**
 * Where every "start" call to action points.
 *
 * A real destination rather than an `onClick` alone, for three reasons: the
 * control works before this page's JavaScript has loaded, it behaves like a
 * link when a visitor middle-clicks or opens it in a new tab, and a crawler
 * that does not execute scripts can see that the front door leads somewhere.
 * `AuthProvider` runs the PRJ-01 anonymous start on arrival either way.
 *
 * "Log in" stays a `<button>`: it opens an identity-provider popup and goes
 * nowhere on its own, so it is an action, not a destination.
 */
const START_HREF = "/dashboard";

export interface LandingPageContentProps {
  /** Whether a sign-in is in flight; disables every control while it is. */
  busy?: boolean;
  /** Shown in the hero when a sign-in attempt failed. */
  loginError?: string | null;
  /**
   * Starts the PRJ-01 anonymous session.
   *
   * The three start controls are anchors with a real `href`, so a click that
   * lands before the page's JavaScript has loaded is still honoured -- by the
   * browser, as an ordinary navigation. This handler is the enhancement on top:
   * it is what makes the same click a client-side navigation once the app is
   * running, and it receives the event so it can decide whether to take it
   * (see `LandingPage`). Absent, every click is a plain navigation.
   */
  onStartFree?: (event: MouseEvent) => void;
  /** Signs in an existing account. */
  onLogIn?: () => void;
  /**
   * The footer's telemetry disclosure (`DEC-009`), supplied by the caller.
   *
   * A slot rather than a direct render because the disclosure reads the
   * consent store, which is exactly the kind of module the prerendered shell
   * must not pull in. The client's copy of this page fills it; the shell
   * leaves it empty and the live page supplies it on mount.
   */
  disclosure?: JSX.Element;
}

export default function LandingPageContent(props: LandingPageContentProps) {
  return (
    <div class="landing">
      <header class="landing-header">
        <a class="landing-brand" href="/">
          <span class="landing-brand-mark" aria-hidden="true" />
          <span>Solid Groove</span>
        </a>
        <nav class="landing-nav" aria-label="Get started">
          <button
            type="button"
            class="landing-button landing-button-quiet"
            disabled={props.busy}
            onClick={() => props.onLogIn?.()}
          >
            {props.busy ? "Logging in…" : "Log in"}
          </button>
          <a
            class="landing-button landing-button-primary"
            href={START_HREF}
            aria-disabled={props.busy ? "true" : undefined}
            onClick={(event) => props.onStartFree?.(event)}
          >
            Start free
          </a>
        </nav>
      </header>

      <main class="landing-main">
        <section class="landing-hero" aria-labelledby="landing-headline">
          <p class="landing-status">Private alpha · browser-based</p>
          <h1 id="landing-headline">
            Bring a loop.
            <br />
            Leave with a track.
          </h1>
          <p class="landing-lede">
            Solid Groove is a music studio that runs in your browser, being built around
            an AI producer that proposes real, editable changes — so you turn a promising
            idea into a finished track and understand how it was made.
          </p>
          <div class="landing-hero-actions">
            <a
              class="landing-button landing-button-primary landing-button-large"
              href={START_HREF}
              aria-disabled={props.busy ? "true" : undefined}
              onClick={(event) => props.onStartFree?.(event)}
            >
              Start in your browser
            </a>
            <p class="landing-hero-hint">
              No account, no install. You land on your projects and can open one in a
              couple of clicks.
            </p>
          </div>
          <p class="landing-support">
            Runs in {GATING_BROWSERS} — the browsers we test every release in. Safari
            should work, but it is not covered by those tests yet.
          </p>
          <Show when={props.loginError}>
            <p class="landing-error" role="alert">
              {props.loginError}
            </p>
          </Show>
        </section>

        <section class="landing-state" aria-labelledby="landing-state-heading">
          <h2 id="landing-state-heading">Where the alpha is today</h2>
          <div class="landing-columns">
            <div class="landing-column">
              <h3 class="landing-column-heading">Working now</h3>
              <ul class="landing-list">
                <For each={WHAT_WORKS_TODAY}>{(item) => <li>{item}</li>}</For>
              </ul>
            </div>
            <div class="landing-column">
              <h3 class="landing-column-heading">Still being built</h3>
              <ul class="landing-list landing-list-pending">
                <For each={WHAT_IS_BEING_BUILT}>{(item) => <li>{item}</li>}</For>
              </ul>
            </div>
          </div>
          <p class="landing-note">
            This is an early build, shared privately. Features change, and things break.
            Guest projects are kept for 180 days after you last open them; to keep them
            indefinitely and open them on another device, start free and then use "Sign up
            with Google" on your projects page. Logging in here opens an existing
            account's own projects, and does not move guest projects into it.
          </p>
        </section>

        <section class="landing-close" aria-labelledby="landing-close-heading">
          <div>
            <h2 id="landing-close-heading">Start with what you've got.</h2>
            <p class="landing-close-copy">
              Open a project and hear it play. Nothing to install, nothing to sign up for.
            </p>
          </div>
          <a
            class="landing-button landing-button-primary landing-button-large"
            href={START_HREF}
            aria-disabled={props.busy ? "true" : undefined}
            onClick={(event) => props.onStartFree?.(event)}
          >
            Start free — no account needed
          </a>
        </section>
      </main>

      <footer class="landing-footer">
        <p class="landing-footer-brand">Solid Groove · private alpha</p>
        {/* `DEC-009`/`FND-001c`: the disclosure and opt-out have their designed
				    home here. `src/app.tsx` renders the floating one on every other
				    surface, and skips it here so there is exactly one on the page. */}
        {props.disclosure}
      </footer>
    </div>
  );
}
