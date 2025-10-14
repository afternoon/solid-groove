import { createContext, createEffect, type Signal, useContext } from "solid-js";
import type { Project } from "../model/types";
import AudioEngine from "./AudioEngine";

const AudioContext = createContext<AudioEngine>();

export function AudioProvider(props: { project: Signal<Project> }) {
	const audio = new AudioEngine();
	createEffect(() => audio.setProject(props.project()));

	return (
		<AudioContext.Provider value={audio}>
			{props.children}
		</AudioContext.Provider>
	);
}

export function useAudio() {
	return useContext(AudioContext) as AudioEngine;
}
