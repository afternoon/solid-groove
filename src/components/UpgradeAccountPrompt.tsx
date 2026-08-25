import { HiSolidUser } from "solid-icons/hi";
import { createSignal, Show } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { authService } from "../auth/authService";

export interface UpgradeAccountPromptProps {
  /** Overridden in tests; defaults to the app-wide analytics boundary. */
  analytics?: Analytics;
}

/**
 * Shown to anonymous users. Links a Google account to the current anonymous
 * account (in place, keeping the same uid) so their existing work becomes
 * accessible from other machines.
 *
 * The retention promise it states (PRD `DEC-001`, section 16): an anonymous
 * project is kept for 180 days from its last access, and upgrading is what
 * makes that indefinite and available on other devices.
 */
export default function UpgradeAccountPrompt(props: UpgradeAccountPromptProps) {
  const analytics = props.analytics ?? defaultAnalytics;
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      await authService.linkWithGoogle();
      // PRD `OPS-02`: `account_upgraded` fires when "an anonymous account
      // becomes a registered account". Google is the alpha's only linking
      // provider (see `authService.linkWithGoogle`).
      analytics.log("account_upgraded", { method: "google" });
    } catch (err) {
      console.error("Error linking Google account:", err);
      setError(
        "Could not link a Google account. It may already be in use — try logging in with it instead.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="upgrade-prompt">
      <p class="upgrade-message">
        You're working as a guest. Guest projects are kept for 180 days after you last
        open them, then removed. Sign up to keep your work indefinitely and open it on any
        device.
      </p>
      <button type="button" disabled={busy()} onClick={upgrade}>
        <HiSolidUser size={18} />
        <span>Sign up with Google</span>
      </button>
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
    </div>
  );
}
