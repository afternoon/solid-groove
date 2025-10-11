import { doc, getFirestore } from "firebase/firestore";
import { useFirebaseApp, useFirestoreOnce } from "solid-firebase";
import { type Component, createMemo, Match, Switch } from "solid-js";
import "./ProjectEditor.css";

type ProjectEditorProps = {
	id: string;
};

export default function ProjectEditor(
	props: ProjectEditorProps,
): Component<ProjectEditorProps> {
	const app = useFirebaseApp();
	const db = getFirestore(app);
	const project = createMemo(() =>
		useFirestoreOnce(doc(db, "projects", props.id)),
	);

	return (
		<main class="project">
			<Switch>
				<Match when={project()?.loading}>
					<p>Loading project...</p>
				</Match>
				<Match when={project()?.error}>
					<p class="error">Error fetching project {props.id}.</p>
				</Match>
				<Match when={project()}>
					<header>
						<div class="project-name">
							<h1>{project().name || "Untitled Project"}</h1>
						</div>
					</header>
				</Match>
			</Switch>
		</main>
	);
}
