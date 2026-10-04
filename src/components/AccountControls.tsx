import { useNavigate } from "@solidjs/router";
import { type JSX, Portal } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { useAuth } from "../auth/AuthProvider";
import { reportError as defaultReportError } from "../monitoring/errorReporting";
import ConfirmDialog from "./ConfirmDialog";

/**
 * The in-app account controls (#951): a guest can log in to an existing
 * account, and a signed-in user can sign out, from wherever they are in the
 * app rather than only from the landing page.
 */
export interface AccountControlProps {
  /** Overridden in tests; defaults to the app-wide analytics boundary. */
  analytics?: Analytics;
  /** Overridden in tests; defaults to the app-wide reporting boundary. */
  reportError?: typeof defaultReportError;
  /** Added to the button, so a surface can style it as one of its own. */
  class?: string;
}

/**
 * What logging in does to a guest's work, said before it happens. It is the
 * landing page's promise in the same words: logging in opens the account's own
 * projects and moves nothing into it, because Google sign-in swaps the uid
 * rather than linking (see `LandingPage.logIn`). Linking is "Sign up with
 * Google", which is why the copy points there for someone who wants to keep
 * their guest projects.
 */
export const LOG_IN_MESSAGE =
  "Logging in opens your account's own projects. Projects you made here as a guest are " +
  'not moved into it; they stay with this guest session. To keep them in an account, cancel and use "Sign up with Google" on your projects page instead.';

const LOG_IN_FAILED_MESSAGE =
  "Could not log in. Try again, or cancel to keep working as a guest.";

/**
 * "Log in" for a guest. It confirms first, because the guest's projects do not
 * come along, and then signs in with Google and opens the projects page: the
 * page the person was on may belong to the guest they just left.
 */
export function LogInButton(props: AccountControlProps): JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const analytics = () => props.analytics ?? defaultAnalytics;
  const reportError = () => props.reportError ?? defaultReportError;
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  const open = () => {
    setFailed(false);
    setConfirming(true);
  };

  const logIn = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await auth.logIn();
      analytics().logFeatureFirstUse("log_in");
      setConfirming(false);
      navigate("/projects");
    } catch (error) {
      // A closed popup is the common case and looks identical to a broken
      // provider from here, so it is reported non-fatally and the dialog stays
      // up to try again.
      reportError()(error, { area: "shell", fatal: false });
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" class={props.class} onClick={open}>
        Log in
      </button>
      <Show when={confirming()}>
        {/* Portalled so a surface's own button styles (the editor header's
            cells) do not reach the dialog's actions. */}
        <Portal>
          <ConfirmDialog
            title="Log in to an existing account?"
            message={failed() ? LOG_IN_FAILED_MESSAGE : LOG_IN_MESSAGE}
            confirmLabel="Log in with Google"
            cancelLabel="Cancel"
            busy={busy()}
            onConfirm={() => void logIn()}
            onCancel={() => setConfirming(false)}
          />
        </Portal>
      </Show>
    </>
  );
}

/**
 * "Sign out" for a signed-in user. The session ends without a new guest
 * starting in its place (`AuthProvider.signOut`), and the app leaves for the
 * landing page, where "Log in" and "Start free" are the two ways back in.
 */
export function SignOutButton(props: AccountControlProps): JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const analytics = () => props.analytics ?? defaultAnalytics;
  const reportError = () => props.reportError ?? defaultReportError;
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  const signOut = async () => {
    if (busy()) return;
    setBusy(true);
    setFailed(false);
    try {
      await auth.signOut();
      analytics().logFeatureFirstUse("sign_out");
      navigate("/");
    } catch (error) {
      reportError()(error, { area: "shell", fatal: false });
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      class={props.class}
      disabled={busy()}
      title={failed() ? "Could not sign out. Try again." : undefined}
      onClick={() => void signOut()}
    >
      {failed() ? "Sign out failed, retry" : "Sign out"}
    </button>
  );
}

/**
 * The one account control a compact surface (the editor header) shows: "Log
 * in" for a guest, "Sign out" for a signed-in user, nothing while the session
 * is still resolving.
 */
export default function AccountControl(props: AccountControlProps): JSX.Element {
  const auth = useAuth();
  return (
    <Show when={auth.user && !auth.loading}>
      <Show when={auth.isAnonymous} fallback={<SignOutButton {...props} />}>
        <LogInButton {...props} />
      </Show>
    </Show>
  );
}
