// Global error capture (PRD `OPS-03`).
//
// "The application's own reporting boundary — global `error` and
// `unhandledrejection` handlers plus the section 10 error boundaries — remains
// the single place errors are captured."
//
// These listeners are the *only* global handlers in the app: Sentry's own
// `globalHandlers` integration is switched off in `sentrySink.ts`, so an
// uncaught error takes exactly one path to exactly one report.
//
// ## Why these are fatal
//
// An error that reaches `window.onerror` or an unhandled rejection was not
// handled by any code that could recover from it. Sentry Release Health treats
// unhandled errors as crashed sessions, which is what the PRD section 11
// crash-free session rate measures. A failure that *was* caught and recovered
// from is reported non-fatally through `reportError` at its own call site.

import type { ErrorArea } from "../analytics/errorCodes";
import { errorReporter, type ErrorReporter } from "./errorReporting";

export interface GlobalHandlerOptions {
	reporter?: ErrorReporter;
	/** Defaults to `window`; injectable so tests need no real global. */
	target?: Pick<Window, "addEventListener" | "removeEventListener">;
	/** Area attributed to errors with no better attribution. */
	area?: ErrorArea;
}

/**
 * Installs the global handlers and returns a disposer.
 *
 * Listeners are passive: they never call `preventDefault()`, so the browser
 * still logs the error to the console for a developer. Reporting observes,
 * it does not intercept.
 */
export function installGlobalErrorHandlers(
	options: GlobalHandlerOptions = {},
): () => void {
	const reporter = options.reporter ?? errorReporter;
	const area = options.area ?? "shell";
	const target =
		options.target ?? (typeof window === "undefined" ? undefined : window);
	if (!target) return () => {};

	const onError = (event: Event): void => {
		// `error` is null for cross-origin script errors ("Script error."), where
		// the browser withholds detail. Fall back to the message so the count is
		// still right, even though the stack will not be useful.
		const errorEvent = event as ErrorEvent;
		const thrown = errorEvent.error ?? errorEvent.message ?? "unknown error";
		safely(() => reporter.report(thrown, { area, fatal: true }));
	};

	const onRejection = (event: Event): void => {
		const rejection = event as PromiseRejectionEvent;
		safely(() => reporter.report(rejection.reason, { area, fatal: true }));
	};

	target.addEventListener("error", onError);
	target.addEventListener("unhandledrejection", onRejection);

	return () => {
		target.removeEventListener("error", onError);
		target.removeEventListener("unhandledrejection", onRejection);
	};
}

/**
 * A listener must never throw: an exception escaping `window.onerror` is
 * reported as another uncaught error, which is the recursion PRD `OPS-03`
 * forbids. `ErrorReporter.report` already guarantees this; the belt here costs
 * nothing and keeps the guarantee local to the handler as well.
 */
function safely(action: () => void): void {
	try {
		action();
	} catch {
		// Nowhere to escalate to, by design.
	}
}
