import { useNavigate } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { createEffect, type ParentProps, Show } from "solid-js";
import { useAuth } from "./AuthProvider";

export interface SignedInOnlyProps extends ParentProps {
  /** Drawn while the session is still being restored. Nothing by default. */
  fallback?: JSX.Element;
}

/**
 * Draws its children for a signed-in session and sends anyone else to the
 * landing page (#854). The alpha is invite-only and guest start is retired,
 * so a visitor with no session has nothing to see on the dashboard or in a
 * project: the landing page is where they sign in or request access. The
 * redirect replaces the address, so Back does not bounce them here again.
 *
 * A guest session from before the alpha closed still counts as signed in:
 * its projects stay open to it until it upgrades.
 */
export default function SignedInOnly(props: SignedInOnlyProps): JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();

  // Both reads in the compute half; the navigation in the apply half.
  createEffect(
    () => auth.loading || auth.user !== null,
    (signedInOrRestoring) => {
      if (!signedInOrRestoring) navigate("/", { replace: true });
    },
  );

  return (
    <Show when={!auth.loading && auth.user !== null} fallback={props.fallback}>
      {props.children}
    </Show>
  );
}
