// The Sentry transport (ADR 0001, PRD `OPS-03`).
//
// **This is the only module in the codebase that imports `@sentry/*`.** It is
// deliberately absent from `src/monitoring/index.ts`, the same way
// `firestoreProjectRepository.ts` is absent from the persistence barrel, so
// application code cannot reach the SDK even by accident. Everything upstream
// talks to `ErrorSink` in `errorReporting.ts`.
//
// ## Configuration decisions, all from ADR 0001
//
// - `sendDefaultPii: false`.
// - `defaultIntegrations: false` with an explicit minimal set. This also
//   disables Sentry's own `globalHandlers` integration, which matters for
//   correctness and not just for bundle size: our boundary owns the global
//   `error`/`unhandledrejection` handlers, and leaving Sentry's enabled would
//   report every uncaught error twice and bypass our scrubbing and our
//   fatal/non-fatal classification.
// - Console breadcrumbs are *disabled*, not filtered.
// - Network and DOM breadcrumbs are scrubbed in `beforeBreadcrumb`, and the
//   whole event again in `beforeSend`.
// - `browserSessionIntegration` provides Release Health, which is where the
//   PRD section 11 crash-free session rate comes from rather than a hand-built
//   derivation.
//
// ## Session Replay (ADR 0002, revised by ADR 0003)
//
// ADR 0002 supersedes ADR 0001 decision 4 and enables replay *for product
// understanding*, under conditions that are all enforced here:
//
// - **Mask text by default** (ADR 0002 decision 2): `maskAllText` and
//   `blockAllMedia` on. Masking happens at capture in the browser, so masked
//   text is never serialized into the payload and therefore never transmitted.
//   Components mark themselves as well (`src/monitoring/replayPrivacy.ts`), so
//   a content surface is masked twice over, and `maskAttributes` covers the
//   names that reach the DOM as attributes rather than text nodes.
// - **Canvas capture is on** (ADR 0003 decision 1, reversing ADR 0002's "canvas
//   capture stays off"). With it off, replay showed a pointer moving across a
//   grey page and a placeholder box where the arrangement should be — useless
//   for the surfaces it exists to observe, since in a DAW the arrangement and
//   piano roll *are* the application. On means sampled recordings include the
//   user's musical work, including the section names the arrangement renderer
//   draws into the canvas: masking does not reach inside a canvas, so nothing
//   there is half-protected. That is a deliberate expansion, disclosed to the
//   user (`TelemetryDisclosure.tsx`) rather than mitigated by a measure that
//   would not work. Reversing it is one flag.
// - **Low session sampling, no error replay** (decision 6):
//   `replaysSessionSampleRate` at `REPLAY_SESSION_SAMPLE_RATE`,
//   `replaysOnErrorSampleRate` at 0. Error-triggered replay is the debugging
//   use ADR 0001 weighed and rejected; nothing here revisits it.
// - **Consent is honoured at the source** (decision 4): when replay consent is
//   absent the integration is *never constructed*, so nothing is captured in
//   the first place rather than being captured and dropped before send.
//   `stopReplay()` stops an in-flight recording when consent is withdrawn
//   mid-session.
// - **Nothing before first paint** (decision 8): replay rides the same lazy
//   import as the rest of the SDK and is not loaded on the landing page at all,
//   which `src/telemetry.ts` and `scripts/verify-bundle-budget.mjs` enforce.
//
// ## The DSN is public by design
//
// `VITE_SENTRY_DSN` ships in the client bundle. That is how a browser SDK
// works: the DSN identifies a project's ingest endpoint and grants nothing but
// the ability to submit events to it. The credential that must never ship is
// `SENTRY_AUTH_TOKEN`, which uploads source maps and creates releases; it
// lives in CI only. See `.env.example` and `docs/testing.md`.

import type { ErrorReport, ErrorSink } from "./errorReporting";
import { MASK_ATTRIBUTES, MASK_CONTENT } from "./replayPrivacy";
import {
	type ScrubbableBreadcrumb,
	type ScrubbableEvent,
	scrubBreadcrumb,
	scrubSentryEvent,
} from "./scrub";

type SentryModule = typeof import("@sentry/solidstart");

export interface SentrySinkOptions {
	dsn?: string;
	release?: string;
	environment?: string;
	/** Injectable for tests, so no test ever loads or initializes the real SDK. */
	load?: () => Promise<SentryModule>;
	/**
	 * Whether Session Replay may capture (ADR 0002 decision 4).
	 *
	 * Read once, at `start()`, and honoured at the source: `false` means the
	 * replay integration is never constructed and `replaysSessionSampleRate` is
	 * 0, so this session records nothing at all. Defaults to `false` so a caller
	 * that has not consulted consent gets the safe outcome.
	 */
	sessionReplay?: boolean;
}

/** Reports buffered while the SDK is still loading. */
const MAX_BUFFERED_REPORTS = 20;

/**
 * ADR 0002 decision 6: "set low (start at 0.1 and adjust against the free-tier
 * quota)".
 *
 * Replay is a sampled qualitative instrument, not a measure any release gate
 * depends on, so an undercount costs nothing structural. The rate is revisited
 * against observed quota during `OPS-001`.
 */
export const REPLAY_SESSION_SAMPLE_RATE = 0.1;

/**
 * ADR 0002 decision 2 as revised by ADR 0003, the whole privacy position of
 * replay in one object.
 *
 * Exported so `sentrySink.test.ts` asserts against the same value the SDK is
 * handed, rather than against a copy that can drift from it.
 *
 * `maskAllText` and `blockAllMedia` mask at capture in the browser: the
 * characters are replaced before serialization, so they never enter the replay
 * payload and are never transmitted. `mask` names the class
 * `src/monitoring/replayPrivacy.ts` puts on content surfaces, so a component's
 * own markup masks it as well as the default does.
 *
 * `maskAttributes` covers the other route a name takes into the DOM. Class
 * marking reaches text nodes and input values, not attributes, and an
 * `aria-label={`Mute ${track.name}`}` carries a name whether or not its
 * element is marked. The SDK *replaces* its default list rather than extending
 * it, so `MASK_ATTRIBUTES` names `title` and `placeholder` too — passing only
 * `aria-label` would quietly unmask two attributes in the course of masking
 * one.
 *
 * There is no `unmask`/`unblock` entry, and no `block` entry either: ADR 0003
 * removed the one blocked surface (the arrangement canvas stack) because
 * blocking it is what made replay useless. Unmasking is permitted only for
 * stable, non-user-authored chrome by an explicit named selector; until a
 * specific surface proves unreadable there is nothing to name.
 */
export const REPLAY_PRIVACY = {
	/** Every text node is masked at capture unless explicitly named otherwise. */
	maskAllText: true,
	/** Images, video, and audio elements are not recorded. */
	blockAllMedia: true,
	/** Text inputs are masked; typed text is user content by definition. */
	maskAllInputs: true,
	/** The class a component marks itself with. */
	mask: [`.${MASK_CONTENT}`],
	/** Names also reach the DOM as attributes; class marking does not cover those. */
	maskAttributes: [...MASK_ATTRIBUTES],
};

/**
 * ADR 0003 decision 1: canvas capture is **on**, reversing ADR 0002 decision
 * 2's "canvas capture stays off".
 *
 * Canvas is not a flag on the replay integration — it is a *second*
 * integration, `replayCanvasIntegration`, which the SDK only records canvas for
 * when it is present. So "on" is the presence of that integration in the
 * `integrations` array, and this is the name a test asserts is present. Naming
 * it here rather than in the test means the assertion cannot pass by matching
 * a string that stopped being the SDK's export name.
 *
 * What this records: the arrangement's clip blocks and waveforms, the piano
 * roll's notes, and the user-authored section names the renderer draws into the
 * content layer. Masking has no reach inside a canvas, so this is all-or-
 * nothing and it is deliberately "all" — the disclosure states it plainly. It
 * is also the larger share of replay's bandwidth and quota cost, which is why
 * `OPS-001` measures consumption with canvas on before the session sample rate
 * is trusted.
 */
export const REPLAY_CANVAS_INTEGRATION = "replayCanvasIntegration";

/**
 * A sink that loads and initializes the Sentry SDK on first use.
 *
 * Construction is synchronous and cheap; `start()` performs the dynamic
 * import. Reports arriving before the SDK is ready are buffered (bounded) and
 * flushed on arrival, so a crash during startup — the most valuable kind — is
 * not lost to the lazy-loading requirement.
 */
export class SentrySink implements ErrorSink {
	private sentry: SentryModule | null = null;
	private starting: Promise<boolean> | null = null;
	private stopped = false;
	private replayEnabled = false;
	private readonly buffered: ErrorReport[] = [];

	constructor(private readonly options: SentrySinkOptions = {}) {}

	get isReady(): boolean {
		return this.sentry !== null;
	}

	/**
	 * Loads and initializes the SDK. Idempotent; resolves `false` when there is
	 * no DSN configured or the SDK could not be loaded — an ad blocker, an
	 * offline first load, a chunk that 404s after a rollback. None of those may
	 * surface to the user (PRD `OPS-03`).
	 */
	start(): Promise<boolean> {
		if (this.starting) return this.starting;
		this.starting = this.startInner().catch(() => false);
		return this.starting;
	}

	private async startInner(): Promise<boolean> {
		const dsn = this.options.dsn ?? readEnv("VITE_SENTRY_DSN");
		if (!dsn) return false;

		const load = this.options.load ?? (() => import("@sentry/solidstart"));
		const sentry = await load();

		// ADR 0002 decision 4: consent is honoured at the source. A declined
		// session constructs no replay integration, so there is nothing to filter
		// on send because there is nothing captured.
		const replayEnabled = this.options.sessionReplay === true;
		this.replayEnabled = replayEnabled;

		sentry.init({
			dsn,
			release: this.options.release,
			environment: this.options.environment ?? "alpha",

			// --- Privacy (ADR 0001) -------------------------------------------
			sendDefaultPii: false,
			// ADR 0002 decision 6. A declined session samples nothing as well as
			// constructing no integration, so neither alone is load-bearing.
			replaysSessionSampleRate: replayEnabled ? REPLAY_SESSION_SAMPLE_RATE : 0,
			// Stays 0 unconditionally: error-triggered replay is the debugging use
			// ADR 0001 rejected, and ADR 0002 explicitly does not revisit it.
			replaysOnErrorSampleRate: 0,
			// No performance tracing. ADR 0001 leaves that to a separate decision.
			tracesSampleRate: 0,

			// --- Minimal integration set --------------------------------------
			defaultIntegrations: false,
			integrations: [
				// Release Health: the source of the section 11 crash-free session rate.
				sentry.browserSessionIntegration(),
				// A second, independent collapse of identical events.
				sentry.dedupeIntegration(),
				sentry.breadcrumbsIntegration({
					// Disabled, not filtered: console arguments routinely contain
					// project state in a music application.
					console: false,
					dom: true,
					fetch: true,
					xhr: true,
					history: true,
					sentry: false,
				}),
				// Both or neither: the canvas integration records nothing on its own,
				// and replay without it is the grey-box replay ADR 0003 rejected.
				...(replayEnabled
					? [
							sentry.replayIntegration(REPLAY_PRIVACY),
							sentry.replayCanvasIntegration(),
						]
					: []),
			],

			// --- Scrubbing ------------------------------------------------------
			// The double casts bridge the SDK's nominal event types and this
			// module's SDK-free structural ones. `scrubSentryEvent` only ever
			// removes fields or replaces strings with shorter strings, so the
			// shape it returns is still a valid event.
			beforeSend: (event) =>
				scrubSentryEvent(
					event as unknown as ScrubbableEvent,
				) as unknown as typeof event,
			beforeBreadcrumb: (breadcrumb) =>
				scrubBreadcrumb(breadcrumb as ScrubbableBreadcrumb) as
					| typeof breadcrumb
					| null,
		});

		this.sentry = sentry;
		this.flushBuffer();
		return true;
	}

	capture(report: ErrorReport): void {
		if (this.stopped) return;
		if (!this.sentry) {
			if (this.buffered.length < MAX_BUFFERED_REPORTS) {
				this.buffered.push(report);
			}
			return;
		}
		this.send(this.sentry, report);
	}

	private flushBuffer(): void {
		const sentry = this.sentry;
		if (!sentry) return;
		const pending = this.buffered.splice(0, this.buffered.length);
		for (const report of pending) {
			this.send(sentry, report);
		}
	}

	private send(sentry: SentryModule, report: ErrorReport): void {
		sentry.captureException(report.error, {
			// `handled: false` is what marks the session crashed in Release
			// Health, so the crash-free session rate reflects fatal errors only.
			mechanism: { type: "solid_groove_boundary", handled: !report.fatal },
			captureContext: {
				level: report.fatal ? "fatal" : "error",
				tags: {
					area: report.area,
					error_code: report.code,
					fatal: report.fatal,
					browser_name: report.browser.browserName,
					browser_version: report.browser.browserVersion,
					engine_name: report.browser.engineName,
					engine_version: report.browser.engineVersion,
				},
			},
		});
	}

	/**
	 * Stops an in-flight Session Replay recording (ADR 0002 decision 4).
	 *
	 * "Opting out mid-session stops an in-flight recording rather than merely
	 * dropping it before send." Closing the client is not enough on its own:
	 * replay buffers in the page and a session already sampled in keeps
	 * recording until it is told to stop, so this is called *before* the close
	 * and separately from it, for the case where replay consent is withdrawn
	 * while error monitoring is still allowed.
	 *
	 * Idempotent and non-throwing. Safe to call when replay was never enabled,
	 * where it does nothing.
	 */
	async stopReplay(): Promise<void> {
		if (!this.replayEnabled) return;
		this.replayEnabled = false;
		try {
			await this.sentry?.getReplay?.()?.stop();
		} catch {
			// A recording we cannot stop must not become an exception on the
			// consent path. The client close below is the backstop.
		}
	}

	/**
	 * Stops sending. Used when the user withdraws consent mid-session: our
	 * boundary already stops forwarding, but `browserSessionIntegration` emits
	 * session updates on its own, so the client itself has to be closed.
	 */
	async stop(): Promise<void> {
		this.stopped = true;
		this.buffered.length = 0;
		// Before the close, so a sampled-in recording is told to stop rather than
		// left to the client teardown (ADR 0002 decision 4).
		await this.stopReplay();
		try {
			await this.sentry?.getClient()?.close();
		} catch {
			// Closing is best-effort; a failure here must not surface anywhere.
		}
		this.sentry = null;
	}
}

function readEnv(key: string): string | undefined {
	try {
		const value = (import.meta.env as Record<string, unknown>)[key];
		return typeof value === "string" && value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}
