import { createContext, useContext } from "solid-js";
import type { ProjectStore } from "../model/project";
import AudioEngine from "./AudioEngine";

const AudioContext = createContext<AudioEngine>();

export function AudioProvider(props: {
	project: ProjectStore;
	children?: any;
}) {
	const audioEngine = new AudioEngine();
	audioEngine.setProjectStore(props.project);

	return (
		<AudioContext.Provider value={audioEngine}>
			{props.children}
		</AudioContext.Provider>
	);
}

export function useAudio() {
	return useContext(AudioContext) as AudioEngine;
}
