import { createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { dataService } from "./dataService";
import type { Project, Song, Track } from "./types";

interface ProjectStoreData {
	data: Project | null;
	loading: boolean;
	error: string | null;
}

export interface ProjectStore extends ProjectStoreData {
	setTempo: (tempo: number) => void;
	setTrack: (trackIndex: number, track: Partial<Track>) => void;
	setSong: (song: Song) => void;
	setProject: (project: Project) => void;
}

export function useProject(id: string): ProjectStore {
	const [store, setStore] = createStore<ProjectStoreData>({
		data: null,
		loading: true,
		error: null,
	});

	createEffect(() => {
		const unsubscribe = dataService.subscribeToProject(id, (project) => {
			setStore(
				produce((state) => {
					state.data = project;
					state.loading = false;
					state.error = null;
				})
			);
		});

		onCleanup(() => unsubscribe());
	});

	const setTempo = (tempo: number) => {
		if (!store.data) return;

		setStore(
			produce((state) => {
				state.data!.latestSnapshot.song.tempo = tempo;
			})
		);

		dataService.updateProject(store.data);
	};

	const setTrack = (trackIndex: number, trackUpdates: Partial<Track>) => {
		if (!store.data) return;

		setStore(
			produce((state) => {
				Object.assign(state.data!.latestSnapshot.song.tracks[trackIndex], trackUpdates);
			})
		);

		dataService.updateProject(store.data);
	};

	const setSong = (song: Song) => {
		if (!store.data) return;

		setStore(
			produce((state) => {
				state.data!.latestSnapshot.song = song;
			})
		);

		dataService.updateProject(store.data);
	};

	const setProject = (project: Project) => {
		setStore(
			produce((state) => {
				state.data = project;
				state.loading = false;
				state.error = null;
			})
		);

		dataService.updateProject(project);
	};

	// Attach methods to the store to preserve reactivity
	store.setTempo = setTempo;
	store.setTrack = setTrack;
	store.setSong = setSong;
	store.setProject = setProject;

	return store as ProjectStore;
}
