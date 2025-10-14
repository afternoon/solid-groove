import { createEffect, createSignal, onCleanup, type Signal } from "solid-js";
import { dataService } from "./dataService";
import type { Project } from "./types";

interface ProjectState {
	loading: boolean;
	error: string | null;
	data: Project | null;
}

export function useProject(id: string): Signal<ProjectState> {
	const [state, setState] = createSignal<ProjectState>({
		loading: true,
		error: null,
		data: null,
	});

	createEffect(() => {
		const unsubscribe = dataService.subscribeToProject(id, (project) => {
			setState({
				loading: false,
				error: null,
				data: project,
			});
		});

		onCleanup(() => unsubscribe());
	});

	return state;
}
