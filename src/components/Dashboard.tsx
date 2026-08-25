import { useNavigate } from "@solidjs/router";
import { HiSolidArrowPath, HiSolidDocumentText, HiSolidPlus } from "solid-icons/hi";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { projectAgeBucket } from "../analytics/buckets";
import { useAuth } from "../auth/AuthProvider";
import { duplicateProject } from "../domain/duplicateProject";
import type { ProjectMetadata } from "../domain/entities";
import { createBlankProject } from "../domain/factories";
import type { ProjectId } from "../domain/ids";
import { createStarterProject } from "../editor/starterProject";
import { getProjectRepository } from "../projectRepositoryClient";
import type { ProjectActionResult } from "./ProjectList";
import ProjectList from "./ProjectList";
import TapeLoader from "./TapeLoader";
import UpgradeAccountPrompt from "./UpgradeAccountPrompt";

interface ProjectsState {
  loading: boolean;
  error: string | null;
  data: ProjectMetadata[];
}

export interface DashboardProps {
  /** Overridden in tests; defaults to the app-wide analytics boundary. */
  analytics?: Analytics;
}

export default function Dashboard(props: DashboardProps = {}) {
  const analytics = props.analytics ?? defaultAnalytics;
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
  // Bumped to force the effect below to re-run and retry.
  const [retryCount, setRetryCount] = createSignal(0);

  createEffect((isFirstRun: boolean) => {
    const id = userId();
    retryCount();
    if (!id) {
      setProjectsState({ loading: false, error: null, data: [] });
      return false;
    }

    // Only show the full loading state on the very first fetch. A retry
    // re-runs this same effect, but the dashboard chrome (button, error
    // panel) is already on screen, so swapping back to the loader would
    // just flash the tape deck in and out again for no benefit — the error
    // panel stays up until the retry resolves one way or the other.
    if (isFirstRun) {
      setProjectsState({ loading: true, error: null, data: [] });
    }

    let cancelled = false;
    getProjectRepository()
      .then((repository) => repository.listProjects(id))
      .then((projects) => {
        if (cancelled) return;
        setProjectsState({ loading: false, error: null, data: projects });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Error fetching projects:", error);
        setProjectsState({
          loading: false,
          error: "Something went wrong while loading your projects.",
          data: [],
        });
      });

    onCleanup(() => {
      cancelled = true;
    });
    return false;
  }, true);

  const retryFetchProjects = () => setRetryCount((count) => count + 1);

  /**
   * `source: "blank"` creates a genuinely empty project; `source: "template"`
   * uses the `FND-009` starter — audible content with no genre attached (the
   * `DEC-002` featured genre templates are `LOOP-015`'s scope, not this one's).
   * Both are the PRD `PRJ-01`/`PRJ-02` creation paths this task owns.
   */
  const createProject = async (source: "blank" | "template") => {
    const id = userId();
    if (!id || creating()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const repository = await getProjectRepository();
      const project =
        source === "blank"
          ? createBlankProject({
              ownerId: id,
              name: "Untitled Project",
              template: "blank",
            })
          : createStarterProject(id);
      const result = await repository.createProject(project);
      if (!result.ok) {
        throw new Error(result.message);
      }
      analytics.log("project_created", { source });
      navigate(`/projects/${project.metadata.id}`);
    } catch (error) {
      console.error("Error creating project:", error);
      setCreateError("Couldn't create a new project. Please try again.");
      setCreating(false);
    }
  };

  const renameProject = async (
    projectId: string,
    name: string,
  ): Promise<ProjectActionResult> => {
    const current = projectsState().data.find((p) => p.id === projectId);
    if (!current) return { ok: false, message: "That project is no longer here." };
    try {
      const repository = await getProjectRepository();
      const result = await repository.saveMetadata(
        projectId as ProjectId,
        { name },
        current.revision,
      );
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      setProjectsState((state) => ({
        ...state,
        data: state.data.map((project) =>
          project.id === projectId
            ? {
                ...project,
                name,
                revision: result.revision,
                modifiedAt: result.modifiedAt,
              }
            : project,
        ),
      }));
      return { ok: true };
    } catch (error) {
      console.error("Error renaming project:", error);
      return { ok: false, message: "Couldn't rename this project." };
    }
  };

  const duplicateExistingProject = async (
    projectId: string,
  ): Promise<ProjectActionResult> => {
    const id = userId();
    if (!id) return { ok: false, message: "Not signed in." };
    try {
      const repository = await getProjectRepository();
      const loaded = await repository.loadProject(projectId as ProjectId);
      if (!loaded.ok) {
        return {
          ok: false,
          message: "Couldn't load this project to duplicate.",
        };
      }
      const duplicate = duplicateProject(loaded.value, { ownerId: id });
      const result = await repository.createProject(duplicate);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      analytics.log("project_created", { source: "duplicate" });
      setProjectsState((state) => ({
        ...state,
        data: [...state.data, duplicate.metadata],
      }));
      return { ok: true };
    } catch (error) {
      console.error("Error duplicating project:", error);
      return { ok: false, message: "Couldn't duplicate this project." };
    }
  };

  const deleteProject = async (projectId: string): Promise<ProjectActionResult> => {
    const current = projectsState().data.find((p) => p.id === projectId);
    try {
      const repository = await getProjectRepository();
      await repository.deleteProject(projectId as ProjectId);
      analytics.log("project_deleted", {
        project_age_bucket: projectAgeBucket(
          Date.now() - (current?.createdAt ?? Date.now()),
        ),
      });
      setProjectsState((state) => ({
        ...state,
        data: state.data.filter((project) => project.id !== projectId),
      }));
      return { ok: true };
    } catch (error) {
      console.error("Error deleting project:", error);
      return { ok: false, message: "Couldn't delete this project." };
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
            <div class="action-row">
              <button
                type="button"
                class="new-project"
                disabled={creating()}
                onClick={() => void createProject("template")}
              >
                <HiSolidPlus size={18} />
                <span>New Project</span>
              </button>
              <button
                type="button"
                class="blank-project"
                disabled={creating()}
                onClick={() => void createProject("blank")}
              >
                <HiSolidDocumentText size={18} />
                <span>Blank Project</span>
              </button>
            </div>
            <Show when={createError()}>
              <p class="create-error">{createError()}</p>
            </Show>
          </div>
          <Show when={auth?.isAnonymous}>
            <UpgradeAccountPrompt analytics={analytics} />
          </Show>
          <Switch>
            <Match when={projectsState().error}>
              <div class="projects-error">
                <p class="projects-error-message">{projectsState().error}</p>
                <button type="button" class="retry-button" onClick={retryFetchProjects}>
                  <HiSolidArrowPath size={16} />
                  <span>Try again</span>
                </button>
              </div>
            </Match>
            <Match when={projectsState().data}>
              <ProjectList
                projects={projectsState().data}
                onRename={renameProject}
                onDuplicate={duplicateExistingProject}
                onDelete={deleteProject}
              />
            </Match>
          </Switch>
        </div>
      </Match>
    </Switch>
  );
}
