import { createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { dataService } from "./dataService";
import type { Project, Song, Track } from "./types";

export interface ProjectStore {
	data: Project | null;
	loading: boolean;
	error: string | null;
}

const [store, setStore] = createStore<ProjectStore>({
	data: null,
	loading: true,
	error: null,
});

export function useProject(id: string): ProjectStore {
	createEffect(() => {
		const unsubscribe = dataService.subscribeToProject(id, (project) => {
			setStore(
				produce((state) => {
					state.data = project;
					state.loading = false;
					state.error = null;
				}),
			);
		});

		onCleanup(() => unsubscribe());
	});

	return store as ProjectStore;
}

export function setTempo(tempo: number) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			state.data!.latestSnapshot.song.tempo = tempo;
		}),
	);

	dataService.updateProject(store.data);
}

export function setTrack(trackIndex: number, trackUpdates: Partial<Track>) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			Object.assign(
				state.data!.latestSnapshot.song.tracks[trackIndex],
				trackUpdates,
			);
		}),
	);

	dataService.updateProject(store.data);
}

export function setSong(song: Song) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			state.data!.latestSnapshot.song = song;
		}),
	);

	dataService.updateProject(store.data);
}

export function setSequenceStep(
	patternIndex: number,
	trackIndex: number,
	stepIndex: number,
	note: string | null,
) {
	if (!store.data) return;

	setStore(
		produce((state) => {
			state.data!.latestSnapshot.song.patterns[patternIndex].sequences[
				trackIndex
			].steps[stepIndex] = note;
		}),
	);

	dataService.updateProject(store.data);
}

export function setProject(project: Project) {
	setStore(
		produce((state) => {
			state.data = project;
			state.loading = false;
			state.error = null;
		}),
	);

	dataService.updateProject(project);
}
