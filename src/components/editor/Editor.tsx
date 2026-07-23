import { For, type JSX, Match, Show, Switch } from "solid-js";
import { AudioProvider } from "../../audio/AudioProvider";
import { useProject } from "../../model/project";
import ProjectNotFound from "../ProjectNotFound";
import TapeLoader from "../TapeLoader";
import Browser from "./Browser";
import EditorAssistant from "./EditorAssistant";
import EditorHeader from "./EditorHeader";
import TrackEditor from "./TrackEditor";
import "./Editor.css";

type EditorProps = {
	id: string;
};

export default function Editor(props: EditorProps): JSX.Element {
	const project = useProject(props.id);

	return (
		<main class="project">
			<Switch>
				<Match when={project.loading}>
					<TapeLoader label="Loading project" />
				</Match>
				<Match when={project.notFound}>
					<ProjectNotFound />
				</Match>
				<Match when={project.error}>
					<div class="project-error">
						<p class="project-error-message">{project.error}</p>
						<div class="project-error-actions">
							<button
								type="button"
								class="project-error-retry"
								onClick={() => location.reload()}
							>
								Try again
							</button>
							<a class="project-error-home" href="/dashboard">
								Back to your projects
							</a>
						</div>
					</div>
				</Match>
				<Match when={project.data}>
					<AudioProvider project={project}>
						<Show when={project.saveError}>
							<p class="save-error-banner">{project.saveError}</p>
						</Show>
						<EditorHeader project={project} />
						<Browser project={project} />
						<div class="workspace">
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
