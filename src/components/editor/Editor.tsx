import { type Component, Match, Switch } from "solid-js";
import { AudioProvider } from "../../audio/AudioProvider";
import { useProject } from "../../model/project";
import EditorHeader from "./EditorHeader";
import "./Editor.css";

type EditorProps = {
	id: string;
};

export default function Editor(props: EditorProps): Component<EditorProps> {
	const project = useProject(props.id);

	return (
		<main class="project">
			<Switch>
				<Match when={project.loading}>
					<p>Loading project...</p>
				</Match>
				<Match when={project.error}>
					<p class="error">Error fetching project {props.id}.</p>
				</Match>
				<Match when={project.data}>
					<AudioProvider project={project}>
						<EditorHeader project={project} />
					</AudioProvider>
				</Match>
			</Switch>
		</main>
	);
}
