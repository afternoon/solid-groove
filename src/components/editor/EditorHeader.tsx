import { HiSolidPlay, HiSolidStop } from "solid-icons/hi";
import { type Component, createMemo, Show } from "solid-js";
import { useAudio } from "../../audio/AudioProvider";
import { usePlaybackHotkey } from "../../audio/usePlaybackHotkey";
import type { ProjectStore } from "../../model/project";

type EditorHeaderProps = {
	project: ProjectStore;
};

export default function EditorHeader(
	props: EditorHeaderProps,
): Component<EditorHeaderProps> {
	const audio = useAudio();

	usePlaybackHotkey(audio);

	function handleToggle() {
		audio.toggle();
	}

	const projectName = createMemo(
		() => props.project.data?.name || "Untitled Project",
	);

	return (
		<header>
			<div class="project-name">
				<h1>{projectName()}</h1>
			</div>
			<div class="transport-controls">
				<button
					type="button"
					class="transport-toggle"
					onClick={handleToggle}
					aria-pressed={audio.isPlaying()}
					aria-label={audio.isPlaying() ? "Stop playback" : "Start playback"}
					title={audio.isPlaying() ? "Stop (space)" : "Play (space)"}
				>
					<Show when={audio.isPlaying()} fallback={<HiSolidPlay size={26} />}>
						<HiSolidStop size={26} />
					</Show>
				</button>
			</div>
			<div class="project-settings"></div>
		</header>
	);
}
