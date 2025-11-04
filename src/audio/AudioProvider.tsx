import { createContext, createEffect, type Signal, useContext } from "solid-js";
import type { Project } from "../model/types";
import AudioEngine from "./AudioEngine";

const AudioContext = createContext<AudioEngine>();

export function AudioProvider(props: { project: Signal<Project> }) {
	const audioEngine = new AudioEngine();
	createEffect(() => {
		const state = props.project();
		if (state?.data) {
			audioEngine.setProject(state.data);
		}
	});

	return (
		<AudioContext.Provider value={audioEngine}>
			{props.children}
		</AudioContext.Provider>
	);
}

export function useAudio() {
	return useContext(AudioContext) as AudioEngine;
}
