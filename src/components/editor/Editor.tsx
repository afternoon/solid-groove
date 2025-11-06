import { type Component, For, Match, Switch } from "solid-js";
import { AudioProvider } from "../../audio/AudioProvider";
import { useProject } from "../../model/project";
import EditorAssetsBar from "./EditorAssetsBar";
import EditorAssistant from "./EditorAssistant";
import EditorHeader from "./EditorHeader";
import TrackEditor from "./TrackEditor";
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
						<EditorAssetsBar project={project} />
						<div class="track-editors">
							<For each={project.data?.latestSnapshot.song.tracks}>
								{(track, index) => {
									// Get the sequence for this track from the first pattern
									const sequence =
										project.data?.latestSnapshot.song.patterns[0]?.sequences[
											index()
										];
									return sequence ? (
										<TrackEditor
											track={track}
											sequence={sequence}
											trackIndex={index()}
										/>
									) : null;
								}}
							</For>
						</div>
						<EditorAssistant project={project} />
					</AudioProvider>
				</Match>
			</Switch>
		</main>
	);
}
