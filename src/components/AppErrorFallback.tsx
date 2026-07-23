import type { Component } from "solid-js";
import "./AppErrorFallback.css";

type AppErrorFallbackProps = {
	error: unknown;
	reset: () => void;
};

/**
 * Root-level fallback for the app's <ErrorBoundary>. Shown when a render-time
 * throw would otherwise leave the app blank. Offers a retry that clears the
 * boundary and re-renders its children.
 */
const AppErrorFallback: Component<AppErrorFallbackProps> = (props) => {
	const message = () =>
		props.error instanceof Error ? props.error.message : String(props.error);

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
