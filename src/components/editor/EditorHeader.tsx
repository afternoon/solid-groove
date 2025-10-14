import { HiSolidPlay, HiSolidStop } from "solid-icons/hi";
import { type Component, createMemo } from "solid-js";
import { useAudio } from "../../audio/AudioProvider";
import type { Project } from "../../model/types";

export default function EditorHeader(props: { project: Project }): Component {
	const audio = useAudio();

	function handlePlay() {
		audio.play();
	}
	function handleStop() {
		audio.stop();
	}

	const projectName = createMemo(
		() => props.project?.name || "Untitled Project",
	);

	return (
		<header>
			<div class="project-name">
				<h1>{projectName()}</h1>
			</div>
			<div className="transport-controls">
				<HiSolidPlay size={26} onClick={handlePlay} />
				<HiSolidStop size={26} onClick={handleStop} />
			</div>
			<div className="project-settings"></div>
		</header>
	);
}
