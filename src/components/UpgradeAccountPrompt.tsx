import { HiSolidUser } from "solid-icons/hi";
import { createSignal, Show } from "solid-js";
import { authService } from "../auth/authService";

/**
 * Shown to anonymous users. Links a Google account to the current anonymous
 * account (in place, keeping the same uid) so their existing work becomes
 * accessible from other machines.
 */
export default function UpgradeAccountPrompt() {
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const upgrade = async () => {
		setBusy(true);
		setError(null);
		try {
			await authService.linkWithGoogle();
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
				You're working as a guest. Sign up to save your work and open it on any
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
