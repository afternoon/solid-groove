import { type Component, onMount } from "solid-js";
import type { ErrorArea } from "../analytics/errorCodes";
import { reportError } from "../monitoring/errorReporting";
import "./AppErrorFallback.css";

type AppErrorFallbackProps = {
	error: unknown;
	reset: () => void;
	/** Which part of the app this boundary guards (PRD `OPS-03`). */
	area?: ErrorArea;
	/** Injectable so component tests assert reporting without a live boundary. */
	report?: typeof reportError;
};

/**
 * Root-level fallback for the app's <ErrorBoundary>. Shown when a render-time
 * throw would otherwise leave the app blank. Offers a retry that clears the
 * boundary and re-renders its children.
 *
 * It is also one of the two capture points PRD `OPS-03` names — "global
 * `error`/`unhandledrejection` handlers plus the section 10 error boundaries".
 * Reporting happens in `onMount` rather than during render so a failing
 * reporter cannot prevent the recovery UI from appearing, and it goes through
 * the application's own boundary rather than a monitoring SDK. Duplicate
 * reports (an error seen by both this boundary and the global handler) are
 * collapsed by fingerprint in `ErrorReporter`.
 *
 * The message shown to the *user* is the raw one — it is their own browser and
 * their own project. Only the message that gets *transmitted* is redacted, by
 * the reporting boundary.
 */
const AppErrorFallback: Component<AppErrorFallbackProps> = (props) => {
	const message = () =>
		props.error instanceof Error ? props.error.message : String(props.error);

	onMount(() => {
		// Fatal: this boundary firing means a surface was replaced by a recovery
		// screen, which is what the section 11 crash-free session rate counts.
		(props.report ?? reportError)(props.error, {
			area: props.area ?? "shell",
			fatal: true,
		});
	});

	return (
		<div class="app-error">
			<div class="app-error-copy">
				<p class="app-error-code">Error</p>
				<h1 class="app-error-title">Something went wrong</h1>
				<p class="app-error-message">{message()}</p>
				<button
					type="button"
					class="app-error-retry"
					onClick={() => props.reset()}
				>
					Try again
				</button>
			</div>
		</div>
	);
};

export default AppErrorFallback;
