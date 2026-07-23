import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { ErrorBoundary, Suspense } from "solid-js";
import AppErrorFallback from "./components/AppErrorFallback";
import TapeLoader from "./components/TapeLoader";
import "./app.css";

export default function App() {
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
				</MetaProvider>
			)}
		>
			<FileRoutes />
		</Router>
	);
}
