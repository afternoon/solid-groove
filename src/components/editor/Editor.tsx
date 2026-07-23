import { For, type JSX, Match, Switch } from "solid-js";
import { AudioProvider } from "../../audio/AudioProvider";
import { useProject } from "../../model/project";
import NotFound from "../NotFound";
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
					<NotFound />
				</Match>
				<Match when={project.error}>
					<p class="error">Error fetching project {props.id}.</p>
				</Match>
				<Match when={project.data}>
					<AudioProvider project={project}>
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
