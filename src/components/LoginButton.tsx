import { useNavigate } from "@solidjs/router";
import { HiSolidUser } from "solid-icons/hi";
import { createEffect, onCleanup } from "solid-js";
import { authService } from "../auth/authService";

export default function LoginButton() {
	const navigate = useNavigate();

	createEffect(() => {
		const unsubscribe = authService.onAuthStateChanged((user) => {
			if (user) {
				navigate("/dashboard");
			}
		});

		onCleanup(() => unsubscribe());
	});

	const signInWithGoogle = async () => {
		try {
			await authService.signInWithGoogle();
		} catch (error) {
			console.error("Error signing in with Google:", error);
		}
	};

	return (
		<button onClick={signInWithGoogle}>
			<HiSolidUser size={20} />
			<span>Log in with Google</span>
		</button>
	);
}
