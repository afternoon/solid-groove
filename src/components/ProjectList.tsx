import type { JSX } from "@solidjs/web";
import since from "since-time-ago";
import { HiSolidDocumentDuplicate, HiSolidPencil, HiSolidTrash } from "solid-icons/hi";
import { createSignal, For, Show } from "solid-js";
import type { ProjectMetadata } from "../domain/entities";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import ConfirmDialog from "./ConfirmDialog";

/** The outcome of a row action, for inline per-row error display. */
export interface ProjectActionResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface ProjectListProps {
  projects: ProjectMetadata[];
  /** Persists a new name. The row returns to read mode on success. */
  onRename?: (
    projectId: string,
    name: string,
  ) => Promise<ProjectActionResult> | ProjectActionResult;
  onDuplicate?: (projectId: string) => Promise<ProjectActionResult> | ProjectActionResult;
  /** Called only after the destructive-confirmation dialog is confirmed. */
  onDelete?: (projectId: string) => Promise<ProjectActionResult> | ProjectActionResult;
}

export default function ProjectList(props: ProjectListProps): JSX.Element {
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [draftName, setDraftName] = createSignal("");
  const [pendingDeleteId, setPendingDeleteId] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [rowError, setRowError] = createSignal<{
    id: string;
    message: string;
  } | null>(null);

  const startRename = (project: ProjectMetadata) => {
    setRowError(null);
    setRenamingId(project.id);
    setDraftName(project.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setDraftName("");
  };

  const saveRename = async (projectId: string) => {
    const name = draftName().trim();
    if (!name || !props.onRename) {
      cancelRename();
      return;
    }
    setBusyId(projectId);
    const result = await props.onRename(projectId, name);
    setBusyId(null);
    if (result.ok) {
      cancelRename();
      setRowError(null);
    } else {
      setRowError({
        id: projectId,
        message: result.message ?? "Rename failed.",
      });
    }
  };

  const duplicate = async (projectId: string) => {
    if (!props.onDuplicate) return;
    setRowError(null);
    setBusyId(projectId);
    const result = await props.onDuplicate(projectId);
    setBusyId(null);
    if (!result.ok) {
      setRowError({
        id: projectId,
        message: result.message ?? "Couldn't duplicate this project.",
      });
    }
  };

  const confirmDelete = async () => {
    const projectId = pendingDeleteId();
    if (!projectId || !props.onDelete) {
      setPendingDeleteId(null);
      return;
    }
    setBusyId(projectId);
    const result = await props.onDelete(projectId);
    setBusyId(null);
    setPendingDeleteId(null);
    if (!result.ok) {
      setRowError({
        id: projectId,
        message: result.message ?? "Couldn't delete this project.",
      });
    }
  };

  return (
    <div class="project-list">
      <Show
        when={props.projects.length > 0}
        fallback={
          <div class="empty-projects">
            <p class="empty-projects-title">No projects yet</p>
            <p class="empty-projects-hint">Create your first one to get started.</p>
          </div>
        }
      >
        <For each={props.projects}>
          {(project) => (
            <div class="project-card">
              <Show
                when={renamingId() === project.id}
                fallback={
                  /* The project's name, chosen by the user. The card around
									   it — dates, badges, actions — stays legible (ADR 0002
									   decision 2). */
                  <p class={`project-title ${MASK_CONTENT}`}>
                    {/* Router 2 has no <A>: it claims plain in-app anchors,
											   so a bare <a> is the only link primitive. */}
                    <a href={`/projects/${project.id}`}>{project.name}</a>
                  </p>
                }
              >
                <form
                  class="project-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename(project.id);
                  }}
                >
                  {/* The name being typed (ADR 0002 decision 2). */}
                  <input
                    class={`project-rename-input ${MASK_CONTENT}`}
                    type="text"
                    value={draftName()}
                    maxlength={120}
                    aria-label={`Rename ${project.name}`}
                    onInput={(event) => setDraftName(event.currentTarget.value)}
                    // Opening rename mode is itself the user's request to type
                    // a new name immediately.
                    autofocus
                  />
                  <button type="submit" disabled={busyId() === project.id}>
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busyId() === project.id}
                    onClick={cancelRename}
                  >
                    Cancel
                  </button>
                </form>
              </Show>

              <p class="project-meta">
                <span>Edited {since(new Date(project.modifiedAt))}</span>
                <Show when={project.template}>
                  <span class="project-badge">{project.template}</span>
                </Show>
                <Show when={project.genre}>
                  <span class="project-badge">{project.genre}</span>
                </Show>
              </p>

              <Show when={renamingId() !== project.id}>
                <div class="project-card-actions">
                  <button
                    type="button"
                    class="project-action"
                    disabled={busyId() === project.id}
                    onClick={() => startRename(project)}
                  >
                    <HiSolidPencil size={14} />
                    <span>Rename</span>
                  </button>
                  <button
                    type="button"
                    class="project-action"
                    disabled={busyId() === project.id}
                    onClick={() => void duplicate(project.id)}
                  >
                    <HiSolidDocumentDuplicate size={14} />
                    <span>Duplicate</span>
                  </button>
                  <button
                    type="button"
                    class="project-action project-action-destructive"
                    disabled={busyId() === project.id}
                    onClick={() => setPendingDeleteId(project.id)}
                  >
                    <HiSolidTrash size={14} />
                    <span>Delete</span>
                  </button>
                </div>
              </Show>

              <Show when={rowError()?.id === project.id}>
                <p class="project-row-error">{rowError()?.message}</p>
              </Show>
            </div>
          )}
        </For>
      </Show>

      <Show when={pendingDeleteId()}>
        {(projectId) => {
          // Derived, not read here: a `Show` child's body is not a tracking
          // scope in Solid 2, so resolving the project eagerly would warn and
          // then never update. Reading it from the JSX below keeps it live.
          const project = () => props.projects.find((p) => p.id === projectId());
          return (
            <ConfirmDialog
              title="Delete this project?"
              message={`"${project()?.name ?? "This project"}" will be permanently deleted. This cannot be undone.`}
              confirmLabel="Delete"
              busy={busyId() === projectId()}
              onCancel={() => setPendingDeleteId(null)}
              onConfirm={() => void confirmDelete()}
            />
          );
        }}
      </Show>
    </div>
  );
}
