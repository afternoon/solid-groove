import type { User } from "firebase/auth";
import {
  createContext,
  createEffect,
  createStore,
  type ParentProps,
  useContext,
} from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { authService } from "./authService";

interface AuthState {
  user: User | null;
  loading: boolean;
  isAnonymous: boolean;
}

const AuthContext = createContext<AuthState>();

export interface AuthProviderProps extends ParentProps {
  /** Overridden in tests; defaults to the app-wide analytics boundary. */
  analytics?: Analytics;
}

export function AuthProvider(props: AuthProviderProps) {
  const analytics = props.analytics ?? defaultAnalytics;
  const [state, setState] = createStore<AuthState>({
    user: null,
    loading: true,
    isAnonymous: false,
  });

  // PRD `OPS-02`: account type is a GA4 *user property*, not an event
  // parameter, and it is the only account fact analytics carries. The
  // boundary attaches it to every subsequent event, so no call site passes
  // it and none can get it wrong.
  //
  // Split effect: every reactive read stays in the compute half, because Solid
  // 2 tracks only what that half touches. All three of `state.loading`,
  // `state.user` and — through `accountTypeOf` — `state.isAnonymous` are read
  // there; a read that slipped into the apply half below would leave the
  // reported account type frozen at whatever it was on the first run.
  createEffect(
    () => (state.loading || !state.user ? "unknown" : accountTypeOf(state)),
    (accountType) => analytics.setAccountType(accountType),
  );

  // Split effect with no reactive dependencies: the subscription is created
  // once and lives until the provider is disposed. It sits in the apply half
  // because that is where a store write is sanctioned in Solid 2, and the
  // unsubscribe rides the cleanup the apply half *returns* rather than a
  // nested `onCleanup`.
  createEffect(
    () => undefined,
    () => {
      const unsubscribe = authService.onAuthStateChanged((user) => {
        if (!user) {
          // No session yet: sign the visitor in anonymously so they can
          // start working immediately. Firebase persists this session
          // locally, so returning users keep their work and uid, and this
          // branch never runs for them — `onAuthStateChanged` reports their
          // existing user directly instead. That is what makes it safe to
          // log `anon_session_created` (PRD `OPS-02`) unconditionally here:
          // reaching this branch at all means a genuinely new anonymous
          // Firebase identity is about to be created, not a returning one.
          authService
            .signInAnonymously()
            .then(() => analytics.log("anon_session_created"))
            .catch((error) => {
              console.error("Error signing in anonymously:", error);
              setState((auth) => {
                auth.user = null;
                auth.loading = false;
                auth.isAnonymous = false;
              });
            });
          return;
        }

        setState((auth) => {
          auth.user = user;
          auth.loading = false;
          auth.isAnonymous = user.isAnonymous;
        });
      });

      return () => unsubscribe();
    },
  );

  return <AuthContext value={state}>{props.children}</AuthContext>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Coarse, non-identifying account fact for the GA4 user property. */
function accountTypeOf(state: AuthState): "anonymous" | "registered" {
  return state.isAnonymous ? "anonymous" : "registered";
}
