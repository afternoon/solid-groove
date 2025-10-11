import { clientOnly } from "@solidjs/start";
import "./index.css";

const LoginButton = clientOnly(() => import("../components/LoginButton"));

export default function IndexPage() {
	return (
		<main>
			<h1>Groove</h1>
			<p>Your collaborative, AI-assisted, browser-based music studio.</p>
			<p style={{ "margin-top": "50px", padding: "0 300px" }}>
				<LoginButton />
			</p>
		</main>
	);
}
