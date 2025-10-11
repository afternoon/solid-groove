import { FirebaseProvider } from "solid-firebase";
import { AuthProvider } from "../auth/AuthProvider";
import Dashboard from "../components/Dashboard";
import { app } from "../firebaseConfig";
import "./dashboard.css";

export default function DashboardPage() {
	return (
		<main class="dashboard">
			<h1>Projects</h1>
			<FirebaseProvider app={app}>
				<AuthProvider>
					<Dashboard />
				</AuthProvider>
			</FirebaseProvider>
		</main>
	);
}
