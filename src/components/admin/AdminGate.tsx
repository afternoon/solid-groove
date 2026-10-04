import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Match, Switch } from "solid-js";
import { useAuth } from "../../auth/AuthProvider";
import { authService } from "../../auth/authService";
import PageNotFound from "../PageNotFound";
import TapeLoader from "../TapeLoader";

export interface AdminGateProps {
  /** Overridden in tests; defaults to reading the `admin` claim off the ID token. */
  isAdmin?: () => Promise<boolean>;
  children: JSX.Element;
}

type Access = "checking" | "admin" | "denied";

/**
 * Shows its children to an admin and the 404 page to everyone else (#854), so
 * the admin page does not even admit to existing. The claim is read again
 * whenever the account changes. This only decides what is drawn: the rules
 * refuse a non-admin's reads and writes whatever the page does.
 */
export default function AdminGate(props: AdminGateProps): JSX.Element {
  const auth = useAuth();
  const isAdmin = props.isAdmin ?? (() => authService.isAdmin());
  const [access, setAccess] = createSignal<Access>("checking");

  // Both reactive reads in the compute half; the async claim read and its
  // writes in the apply half, which returns the cancellation.
  createEffect(
    () => ({ loading: auth.loading, uid: auth.user?.uid }),
    ({ loading, uid }) => {
      if (loading) {
        setAccess("checking");
        return;
      }
      if (!uid) {
        setAccess("denied");
        return;
      }
      setAccess("checking");
      let cancelled = false;
      isAdmin()
        .then((admin) => {
          if (!cancelled) setAccess(admin ? "admin" : "denied");
        })
        .catch(() => {
          if (!cancelled) setAccess("denied");
        });
      return () => {
        cancelled = true;
      };
    },
  );

  return (
    <Switch>
      <Match when={access() === "checking"}>
        <TapeLoader label="Loading" />
      </Match>
      <Match when={access() === "denied"}>
        <PageNotFound />
      </Match>
      <Match when={access() === "admin"}>{props.children}</Match>
    </Switch>
  );
}
