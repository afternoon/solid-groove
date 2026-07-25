import {
	createContext,
	createUniqueId,
	type JSX,
	onCleanup,
	useContext,
} from "solid-js";
import type { ProjectStore } from "../model/project";
import { getAudioRuntime } from "./AudioRuntime";
import SongPlayer from "./SongPlayer";

const SongPlayerContext = createContext<SongPlayer>();

export function AudioProvider(props: {
	project: ProjectStore;
	children?: JSX.Element;
}) {
	// Every mount gets its own owner id so its Tone resources are tracked (and
	// disposed) independently of any other project graph the runtime is
	// holding — but always through the one shared `AudioRuntime`, never a
	// context of its own (PRD AUD-07).
	const ownerId = `project-graph:${createUniqueId()}`;
	const songPlayer = new SongPlayer(getAudioRuntime(), ownerId);
	songPlayer.setProjectStore(props.project);

	// Route/component teardown disposes this project's Tone graph without
	// touching the shared real-time context, which stays alive for the next
	// project.
	onCleanup(() => {
		songPlayer.dispose();
	});

	return (
		<SongPlayerContext.Provider value={songPlayer}>
			{props.children}
		</SongPlayerContext.Provider>
	);
}

export function useAudio() {
	return useContext(SongPlayerContext) as SongPlayer;
}
