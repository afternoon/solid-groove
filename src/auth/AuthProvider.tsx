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
  /**
   * The anonymous sign-in a visitor with no session needs has failed (a
   * dropped network, most often). `user` is `null` and `loading` is `false`
   * alongside it, so a consumer can tell "signing in" from "could not sign in"
   * and offer `retrySignIn` instead of waiting forever (#868).
   */
  signInFailed: boolean;
}

export interface AuthContextValue extends Readonly<AuthState> {
  /** Attempts the anonymous sign-in again after `signInFailed`. */
  retrySignIn(): void;
  /**
   * Logs in to an existing account (#951). This *signs in*, it does not link:
   * the session moves to that account's uid, and any projects made as a guest
   * stay with the guest. Rejects if the provider does (a closed popup, most
   * often), leaving the current session as it was.
   */
  logIn(): Promise<void>;
  /**
   * Ends the session (#951). Unlike a visitor arriving with no session, this
   * does not start a new guest: the provider reports no user and the caller
   * decides where to go (the app leaves for `/`).
   */
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();

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
    signInFailed: false,
  });

  // No session yet: sign the visitor in anonymously so they can start working
  // immediately. Firebase persists this session locally, so returning users
  // keep their work and uid, and this never runs for them —
  // `onAuthStateChanged` reports their existing user directly instead. That
  // is what makes it safe to log `anon_session_created` (PRD `OPS-02`)
  // unconditionally on success: reaching here at all means a genuinely new
  // anonymous Firebase identity is about to be created, not a returning one.
  //
  // A failure is a state, not just a log line: the consumer is told with
  // `signInFailed` so it can stop showing its loader and offer a retry.
  // Success needs no write here — `onAuthStateChanged` reports the new user.
  const signInAnonymously = () => {
    authService
      .signInAnonymously()
      .then(() => analytics.log("anon_session_created"))
      .catch((error) => {
        console.error("Error signing in anonymously:", error);
        setState((auth) => {
          auth.user = null;
          auth.loading = false;
          auth.isAnonymous = false;
          auth.signInFailed = true;
        });
      });
  };

  // Set while the session is ending on purpose, so the no-user report that
  // follows a sign-out is not mistaken for a first visit and answered with a
  // fresh anonymous session the person just asked to leave.
  let signingOut = false;

  const logIn = () => authService.signInWithGoogle();

  const signOut = async () => {
    signingOut = true;
    try {
      await authService.signOut();
    } catch (error) {
      signingOut = false;
      throw error;
    }
  };

  const retrySignIn = () => {
    if (!state.signInFailed) return;
    setState((auth) => {
      auth.loading = true;
      auth.signInFailed = false;
    });
    signInAnonymously();
  };

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
          if (signingOut) {
            setState((auth) => {
              auth.user = null;
              auth.loading = false;
              auth.isAnonymous = false;
            });
            return;
          }
          signInAnonymously();
          return;
        }
        signingOut = false;

        setState((auth) => {
          auth.user = user;
          auth.loading = false;
          auth.isAnonymous = user.isAnonymous;
          auth.signInFailed = false;
        });
      });

      return () => unsubscribe();
    },
  );

  // Getters, so every read still goes through the store and stays reactive.
  const value: AuthContextValue = {
    get user() {
      return state.user;
    },
    get loading() {
      return state.loading;
    },
    get isAnonymous() {
      return state.isAnonymous;
    },
    get signInFailed() {
      return state.signInFailed;
    },
    retrySignIn,
    logIn,
    signOut,
  };

  return <AuthContext value={value}>{props.children}</AuthContext>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Coarse, non-identifying account fact for the GA4 user property. */
function accountTypeOf(state: AuthState): "anonymous" | "registered" {
  return state.isAnonymous ? "anonymous" : "registered";
}
