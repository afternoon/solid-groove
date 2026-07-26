import type { User } from "firebase/auth";
import {
	createContext,
	createEffect,
	onCleanup,
	type ParentProps,
	useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import { analytics } from "../analytics/analytics";
import { authService } from "./authService";

interface AuthState {
	user: User | null;
	loading: boolean;
	isAnonymous: boolean;
}

const AuthContext = createContext<AuthState>();

export function AuthProvider(props: ParentProps) {
	const [state, setState] = createStore<AuthState>({
		user: null,
		loading: true,
		isAnonymous: false,
	});

	// PRD `OPS-02`: account type is a GA4 *user property*, not an event
	// parameter, and it is the only account fact analytics carries. The
	// boundary attaches it to every subsequent event, so no call site passes
	// it and none can get it wrong.
	createEffect(() => {
		analytics.setAccountType(
			state.loading ? "unknown" : state.user ? accountTypeOf(state) : "unknown",
		);
	});

	createEffect(() => {
		const unsubscribe = authService.onAuthStateChanged((user) => {
			if (!user) {
				// No session yet: sign the visitor in anonymously so they can
				// start working immediately. Firebase persists this session
				// locally, so returning users keep their work and uid.
				authService.signInAnonymously().catch((error) => {
					console.error("Error signing in anonymously:", error);
					setState({ user: null, loading: false, isAnonymous: false });
				});
				return;
			}

			setState({ user, loading: false, isAnonymous: user.isAnonymous });
		});

		onCleanup(() => unsubscribe());
	});

	return (
		<AuthContext.Provider value={state}>{props.children}</AuthContext.Provider>
	);
}

export function useAuth() {
	return useContext(AuthContext) as AuthState;
}

/** Coarse, non-identifying account fact for the GA4 user property. */
function accountTypeOf(state: AuthState): "anonymous" | "registered" {
	return state.isAnonymous ? "anonymous" : "registered";
}
