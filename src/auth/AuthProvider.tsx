import { useNavigate } from "@solidjs/router";
import type { User } from "firebase/auth";
import {
	createContext,
	createEffect,
	onCleanup,
	type ParentProps,
	useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import { authService } from "./authService";

interface AuthState {
	user: User | null;
	loading: boolean;
}

const AuthContext = createContext<AuthState>();

export function AuthProvider(props: ParentProps) {
	const [state, setState] = createStore<AuthState>({
		user: null,
		loading: true,
	});

	const navigate = useNavigate();

	createEffect(() => {
		const unsubscribe = authService.onAuthStateChanged((user) => {
			if (!user) {
				navigate("/");
				return;
			}

			setState({ user, loading: false });
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
