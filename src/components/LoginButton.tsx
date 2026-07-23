import { useNavigate } from "@solidjs/router";
import { HiSolidBolt, HiSolidUser } from "solid-icons/hi";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { authService } from "../auth/authService";

export default function LoginButton() {
	const navigate = useNavigate();
	const [busy, setBusy] = createSignal(false);

	createEffect(() => {
		const unsubscribe = authService.onAuthStateChanged((user) => {
			if (user) {
				navigate("/dashboard");
			}
		});

		onCleanup(() => unsubscribe());
	});

	const startCreating = async () => {
		setBusy(true);
		try {
			await authService.signInAnonymously();
		} catch (error) {
			console.error("Error starting anonymous session:", error);
			setBusy(false);
		}
	};

	const signInWithGoogle = async () => {
		setBusy(true);
		try {
			await authService.signInWithGoogle();
		} catch (error) {
			console.error("Error signing in with Google:", error);
			setBusy(false);
		}
	};

	return (
		<div class="entry-actions">
			<button
				class="primary"
				type="button"
				disabled={busy()}
				onClick={startCreating}
			>
				<HiSolidBolt size={20} />
				<span>Start creating</span>
			</button>
			<button
				class="secondary"
				type="button"
				disabled={busy()}
				onClick={signInWithGoogle}
			>
				<HiSolidUser size={20} />
				<span>Log in with Google</span>
			</button>
			<p class="entry-hint">
				No account needed — jump right in. You can sign in later to save your
				work across devices.
			</p>
		</div>
	);
}
