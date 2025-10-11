import { collection, getFirestore, query, where } from "firebase/firestore";
import { useFirebaseApp, useFirestore } from "solid-firebase";
import { createMemo, Match, Switch } from "solid-js";
import { useAuth } from "../auth/AuthProvider";
import ProjectList from "./ProjectList";

export default function Dashboard() {
	const app = useFirebaseApp();
	const auth = useAuth();
	const userId = createMemo(() => auth?.user?.uid);
	const db = getFirestore(app);
	const projects = createMemo(() =>
		userId()
			? useFirestore(
					query(collection(db, "projects"), where("ownerId", "==", userId())),
				)
			: undefined,
	);

	return (
		<Switch>
			<Match when={!userId() || projects()?.loading}>
				<p class="loading">Loading projects...</p>
			</Match>
			<Match when={userId()}>
				<p>User ID: {userId()}</p>
				<Switch>
					<Match when={projects()?.error}>
						<p class="error">Error fetching projects.</p>
						<p class="error">{projects()?.error?.toString()}</p>
					</Match>
					<Match when={projects()?.data}>
						<ProjectList projects={projects()!.data} />
					</Match>
				</Switch>
			</Match>
		</Switch>
	);
}
