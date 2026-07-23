import { useNavigate } from "@solidjs/router";
import { HiSolidPlus } from "solid-icons/hi";
import {
	createEffect,
	createMemo,
	createSignal,
	Match,
	onCleanup,
	Show,
	Switch,
} from "solid-js";
import { useAuth } from "../auth/AuthProvider";
import { dataService } from "../model/dataService";
import { newProject } from "../model/newProject";
import type { Project } from "../model/types";
import ProjectList from "./ProjectList";
import UpgradeAccountPrompt from "./UpgradeAccountPrompt";

interface ProjectsState {
	loading: boolean;
	error: string | null;
	data: Project[];
}

export default function Dashboard() {
	const auth = useAuth();
	const navigate = useNavigate();
	const userId = createMemo(() => auth?.user?.uid);
	const [creating, setCreating] = createSignal(false);
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

	const createProject = async () => {
		const id = userId();
		if (!id || creating()) return;
		setCreating(true);
		try {
			const projectId = await dataService.createProject(newProject(id));
			navigate(`/projects/${projectId}`);
		} catch (error) {
			console.error("Error creating project:", error);
			setCreating(false);
		}
	};

	return (
		<Switch>
			<Match when={!userId() || projectsState().loading}>
				<p class="loading">Loading projects...</p>
			</Match>
			<Match when={userId()}>
				<Show when={auth?.isAnonymous}>
					<UpgradeAccountPrompt />
				</Show>
				<div class="dashboard-actions">
					<button
						type="button"
						class="new-project"
						disabled={creating()}
						onClick={createProject}
					>
						<HiSolidPlus size={18} />
						<span>New Project</span>
					</button>
				</div>
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
