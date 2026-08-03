import { useNavigate } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import type { AuthService } from "../auth/authService";
import { reportError as defaultReportError } from "../monitoring/errorReporting";
import TelemetryDisclosure from "./TelemetryDisclosure";
import "./LandingPage.css";

/**
 * The public marketing landing page (PRD `PRJ-06`, task `LOOP-001b`).
 *
 * The product's front door, and the entry point into the PRJ-01 anonymous
 * start. Design reference: `docs/design/mocks/04-landing-page.png`. The mock is
 * directional — it shows a full marketing site with a tour, pricing, and
 * capabilities the alpha has not built — so this page keeps the mock's
 * structure and visual language and carries only claims that are true today.
 *
 * ## Honesty is a requirement here, not a tone
 *
 * `PRJ-06`: the page "does not advertise capabilities beyond the current
 * milestone". `WHAT_WORKS_TODAY` and `WHAT_IS_BEING_BUILT` below are the two
 * lists that make that checkable rather than a matter of taste, and they are
 * the part of this file that goes stale: a task that ships one of the "being
 * built" capabilities moves its line across. Nothing else on the page names a
 * feature, so nothing else has to be revisited.
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
			setLoginError(
				"Could not log in. Try again, or start free without an account.",
			);
			setBusy(false);
		}
	};

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
						disabled={busy()}
						onClick={() => void logIn()}
					>
						{busy() ? "Logging in…" : "Log in"}
					</button>
					<button
						type="button"
						class="landing-button landing-button-primary"
						disabled={busy()}
						onClick={startFree}
					>
						Start free
					</button>
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
						Solid Groove is a music studio that runs in your browser, being
						built around an AI producer that proposes real, editable changes —
						so you turn a promising idea into a finished track and understand
						how it was made.
					</p>
					<div class="landing-hero-actions">
						<button
							type="button"
							class="landing-button landing-button-primary landing-button-large"
							disabled={busy()}
							onClick={startFree}
						>
							Start in your browser
						</button>
						<p class="landing-hero-hint">
							No account, no install. You land on your projects and can open one
							in a couple of clicks.
						</p>
					</div>
					<p class="landing-support">
						Runs in {GATING_BROWSERS} — the browsers we test every release in.
						Safari should work, but it is not covered by those tests yet.
					</p>
					<Show when={loginError()}>
						<p class="landing-error" role="alert">
							{loginError()}
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
								<For each={WHAT_IS_BEING_BUILT}>
									{(item) => <li>{item}</li>}
								</For>
							</ul>
						</div>
					</div>
					<p class="landing-note">
						This is an early build, shared privately. Features change, and
						things break. Guest projects are kept for 180 days after you last
						open them; to keep them indefinitely and open them on another
						device, start free and then use "Sign up with Google" on your
						projects page. Logging in here opens an existing account's own
						projects, and does not move guest projects into it.
					</p>
				</section>

				<section class="landing-close" aria-labelledby="landing-close-heading">
					<div>
						<h2 id="landing-close-heading">Start with what you've got.</h2>
						<p class="landing-close-copy">
							Open a project and hear it play. Nothing to install, nothing to
							sign up for.
						</p>
					</div>
					<button
						type="button"
						class="landing-button landing-button-primary landing-button-large"
						disabled={busy()}
						onClick={startFree}
					>
						Start free — no account needed
					</button>
				</section>
			</main>

			<footer class="landing-footer">
				<p class="landing-footer-brand">Solid Groove · private alpha</p>
				{/* `DEC-009`/`FND-001c`: the disclosure and opt-out have their designed
				    home here. `src/app.tsx` renders the floating one on every other
				    surface, and skips it here so there is exactly one on the page. */}
				<TelemetryDisclosure placement="inline" />
			</footer>
		</div>
	);
}
