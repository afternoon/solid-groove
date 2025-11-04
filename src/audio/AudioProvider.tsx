import { createContext, useContext } from "solid-js";
import type { ProjectStore } from "../model/project";
import SongPlayer from "./SongPlayer";

const SongPlayerContext = createContext<SongPlayer>();

export function AudioProvider(props: {
	project: ProjectStore;
	children?: any;
}) {
	const songPlayer = new SongPlayer();
	songPlayer.setProjectStore(props.project);

	return (
		<SongPlayerContext.Provider value={songPlayer}>
			{props.children}
		</SongPlayerContext.Provider>
	);
}

export function useAudio() {
	return useContext(SongPlayerContext) as SongPlayer;
}
