import {
	createEffect,
	createMemo,
	createSignal,
	Match,
	onCleanup,
	Switch,
} from "solid-js";
import { useAuth } from "../auth/AuthProvider";
import { dataService } from "../model/dataService";
import type { Project } from "../model/types";
import ProjectList from "./ProjectList";

interface ProjectsState {
	loading: boolean;
	error: string | null;
	data: Project[];
}

export default function Dashboard() {
	const auth = useAuth();
	const userId = createMemo(() => auth?.user?.uid);
	const [projectsState, setProjectsState] = createSignal<ProjectsState>({
		loading: true,
		error: null,
		data: [],
	});

	createEffect(() => {
		const id = userId();
		if (!id) {
			setProjectsState({ loading: false, error: null, data: [] });
			return;
		}

		const unsubscribe = dataService.subscribeToUserProjects(id, (projects) => {
			setProjectsState({
				loading: false,
				error: null,
				data: projects,
			});
		});

		onCleanup(() => unsubscribe());
	});

	return (
		<Switch>
			<Match when={!userId() || projectsState().loading}>
				<p class="loading">Loading projects...</p>
			</Match>
			<Match when={userId()}>
				<p>User ID: {userId()}</p>
				<Switch>
					<Match when={projectsState().error}>
						<p class="error">Error fetching projects.</p>
						<p class="error">{projectsState().error}</p>
					</Match>
					<Match when={projectsState().data}>
						<ProjectList projects={projectsState().data} />
					</Match>
				</Switch>
			</Match>
		</Switch>
	);
}
