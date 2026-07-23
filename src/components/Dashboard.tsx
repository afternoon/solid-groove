import { useNavigate } from "@solidjs/router";
import { HiSolidArrowPath, HiSolidPlus } from "solid-icons/hi";
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
import TapeLoader from "./TapeLoader";
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
	const [createError, setCreateError] = createSignal<string | null>(null);
	const [projectsState, setProjectsState] = createSignal<ProjectsState>({
		loading: true,
		error: null,
		data: [],
	});
	// Bumped to force the subscription effect below to re-run and retry.
	const [retryCount, setRetryCount] = createSignal(0);

	createEffect((isFirstRun: boolean) => {
		const id = userId();
		retryCount();
		if (!id) {
			setProjectsState({ loading: false, error: null, data: [] });
			return false;
		}

		// Only show the full loading state on the very first subscribe. A retry
		// re-runs this same effect, but the dashboard chrome (button, error
		// panel) is already on screen, so swapping back to the loader would
		// just flash the tape deck in and out again for no benefit — the error
		// panel stays up until the retry resolves one way or the other.
		if (isFirstRun) {
			setProjectsState({ loading: true, error: null, data: [] });
		}

		const unsubscribe = dataService.subscribeToUserProjects(
			id,
			(projects) => {
				setProjectsState({
					loading: false,
					error: null,
					data: projects,
				});
			},
			(error) => {
				console.error("Error fetching projects:", error);
				setProjectsState({
					loading: false,
					error: "Something went wrong while loading your projects.",
					data: [],
				});
			},
		);

		onCleanup(() => unsubscribe());
		return false;
	}, true);

	const retryFetchProjects = () => setRetryCount((count) => count + 1);

	const createProject = async () => {
		const id = userId();
		if (!id || creating()) return;
		setCreating(true);
		setCreateError(null);
		try {
			const projectId = await dataService.createProject(newProject(id));
			navigate(`/projects/${projectId}`);
		} catch (error) {
			console.error("Error creating project:", error);
			setCreateError("Couldn't create a new project. Please try again.");
			setCreating(false);
		}
	};

	return (
		<Switch>
			<Match when={!userId() || projectsState().loading}>
				<TapeLoader label="Loading projects" />
			</Match>
			<Match when={userId()}>
				{/* Wrapped in a single element: Match/Show render a list of sibling
				    children as-is without re-running reactively as a group, so the
				    conditional error/list swap below needs to live inside its own
				    single reactive container to update correctly on retry. */}
				<div>
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
						<Show when={createError()}>
							<p class="create-error">{createError()}</p>
						</Show>
					</div>
					<Show when={auth?.isAnonymous}>
						<UpgradeAccountPrompt />
					</Show>
					<Switch>
						<Match when={projectsState().error}>
							<div class="projects-error">
								<p class="projects-error-message">{projectsState().error}</p>
								<button
									type="button"
									class="retry-button"
									onClick={retryFetchProjects}
								>
									<HiSolidArrowPath size={16} />
									<span>Try again</span>
								</button>
							</div>
						</Match>
						<Match when={projectsState().data}>
							<ProjectList projects={projectsState().data} />
						</Match>
					</Switch>
				</div>
			</Match>
		</Switch>
	);
}
