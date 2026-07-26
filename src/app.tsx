import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { ErrorBoundary, onMount, Suspense } from "solid-js";
import AppErrorFallback from "./components/AppErrorFallback";
import ReleaseBadge from "./components/ReleaseBadge";
import TapeLoader from "./components/TapeLoader";
import { syncInternalTraffic } from "./shared/internalTraffic";
import "./app.css";

export default function App() {
	// PRD `OPS-01`: mark internal/team traffic once per app load so it can be
	// excluded from the section 11 measures later (`FND-001c` reads the
	// persisted flag). Outside the Router's `root` render prop so it runs once
	// regardless of which route was entered, not once per navigation.
	onMount(() => {
		syncInternalTraffic();
	});

	return (
		<Router
			root={(props) => (
				<MetaProvider>
					<Title>Groove</Title>
					<ErrorBoundary
						fallback={(err, reset) => (
							<AppErrorFallback error={err} reset={reset} />
						)}
					>
						<Suspense fallback={<TapeLoader label="Loading" />}>
							{props.children}
						</Suspense>
					</ErrorBoundary>
					{/* Outside the ErrorBoundary/Suspense so the deployed revision
					    stays visible/inspectable even while the app is loading or has
					    hit an error -- exactly when knowing the build matters most. */}
					<ReleaseBadge />
				</MetaProvider>
			)}
		>
			<FileRoutes />
		</Router>
	);
}
