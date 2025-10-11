import { useNavigate } from "@solidjs/router";
import {
	GoogleAuthProvider,
	onAuthStateChanged,
	signInWithPopup,
} from "firebase/auth";
import { HiSolidUser } from "solid-icons/hi";
import { createEffect, onCleanup } from "solid-js";
import { auth } from "../firebaseConfig";

export default function LoginButton() {
	const navigate = useNavigate();

	createEffect(() => {
		const unsubscribe = onAuthStateChanged(auth, (user) => {
			if (user) {
				navigate("/dashboard");
			}
		});

		onCleanup(() => unsubscribe());
	});

	const signInWithGoogle = async () => {
		const provider = new GoogleAuthProvider();
		try {
			await signInWithPopup(auth, provider);
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
