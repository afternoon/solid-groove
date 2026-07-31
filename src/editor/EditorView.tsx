import {
	HiSolidArrowUturnLeft,
	HiSolidArrowUturnRight,
	HiSolidPlay,
	HiSolidStop,
} from "solid-icons/hi";
import {
	createMemo,
	createResource,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import { usePlaybackHotkey } from "../audio/usePlaybackHotkey";
import ProjectNotFound from "../components/ProjectNotFound";
import TapeLoader from "../components/TapeLoader";
import type { SaveFailureReason } from "../persistence/projectRepository";
import { getProjectRepository } from "../projectRepositoryClient";
import StepGrid from "./StepGrid";
import { useEditorSession } from "./useEditorSession";
import { useProjectAudio } from "./useProjectAudio";
import "./EditorView.css";

export interface EditorViewProps {
	readonly projectId: string;
}

const SAVE_STATUS_LABEL: Record<string, string> = {
	idle: "",
	pending: "Saving…",
	saving: "Saving…",
	saved: "Saved",
	failed: "Save failed",
};

/**
 * Actionable text for the PRD `PRJ-03` "actionable Save failed" state. Never
 * the repository's raw `SaveFailure.message` — that can carry backend error
 * text not meant for a user-facing surface — and never the reason string
 * itself, which is an internal, unlocalized identifier.
 */
const SAVE_FAILURE_REASON_LABEL: Record<SaveFailureReason, string> = {
	unavailable: "Check your connection.",
	revision_conflict: "This project changed in another tab or session.",
	not_found: "This project no longer exists.",
	already_exists: "A save conflict occurred.",
	unsupported_schema_version:
		"This project needs a newer version of Solid Groove.",
	invalid_document: "Something about this save wasn't valid.",
	document_too_large: "This project is too large to save further changes.",
};

/**
 * The `FND-009` foundation vertical slice: open a schema-v1 project, edit its
 * 16-step sampler track, hear it, undo it, and let autosave save it — the
 * smallest surface that exercises the real UI-to-command-to-audio-to-
 * persistence path end to end. Superseded by `LOOP-010`'s full step editor;
 * not meant to be grown into it (see `docs/backlog.md#fnd-009`).
 */
export default function EditorView(props: EditorViewProps): JSX.Element {
	const [repositoryResource] = createResource(() => getProjectRepository());
	const session = useEditorSession(
		() => props.projectId,
		() => repositoryResource() ?? null,
	);

	const project = createMemo(() => session.state.project);
	const audio = useProjectAudio(project);
	usePlaybackHotkey({ toggle: () => void audio.toggle() });

	const track = createMemo(() => project()?.song.tracks[0] ?? null);
	const clip = createMemo(() => {
		const currentProject = project();
		const currentTrack = track();
		if (!currentProject || !currentTrack) return null;
		return (
			currentProject.clips.find((c) => c.trackId === currentTrack.id) ?? null
		);
	});

	const packDependencyLabel = createMemo(() => {
		const dependency = project()?.metadata.packDependencies[0];
		return dependency ? `${dependency.packId} @ ${dependency.version}` : null;
	});

	const saveStatusLabel = createMemo(
		() => SAVE_STATUS_LABEL[session.state.saveStatus?.state ?? "idle"],
	);
	const saveFailure = createMemo(() => session.state.saveStatus?.failure);
	const saveFailureMessage = createMemo(() => {
		const failure = saveFailure();
		return failure ? SAVE_FAILURE_REASON_LABEL[failure.reason] : null;
	});

	return (
		<main class="editor">
			<Switch>
				<Match when={session.state.loading}>
					<TapeLoader label="Loading project" />
				</Match>
				<Match when={session.state.notFound}>
					<ProjectNotFound />
				</Match>
				<Match when={session.state.error}>
					<div class="project-error">
						<p class="project-error-message">{session.state.error}</p>
						<div class="project-error-actions">
							<button
								type="button"
								class="project-error-retry"
								onClick={() => location.reload()}
							>
								Try again
							</button>
							<a class="project-error-home" href="/dashboard">
								Back to your projects
							</a>
						</div>
					</div>
				</Match>
				<Match when={project()}>
					{(currentProject) => (
						<>
							<header class="editor-header">
								<h1 class="project-name">{currentProject().metadata.name}</h1>
								<div class="transport-controls">
									<button
										type="button"
										class="undo-button"
										disabled={!session.state.canUndo}
										aria-label={
											session.state.undoSummary
												? `Undo ${session.state.undoSummary}`
												: "Undo"
										}
										title={session.state.undoSummary ?? "Undo"}
										onClick={() => session.undo()}
									>
										<HiSolidArrowUturnLeft size={18} />
									</button>
									<button
										type="button"
										class="redo-button"
										disabled={!session.state.canRedo}
										aria-label={
											session.state.redoSummary
												? `Redo ${session.state.redoSummary}`
												: "Redo"
										}
										title={session.state.redoSummary ?? "Redo"}
										onClick={() => session.redo()}
									>
										<HiSolidArrowUturnRight size={18} />
									</button>
									<button
										type="button"
										class="transport-toggle"
										onClick={() => void audio.toggle()}
										aria-pressed={audio.isPlaying()}
										aria-label={
											audio.isPlaying() ? "Stop playback" : "Start playback"
										}
										title={audio.isPlaying() ? "Stop (space)" : "Play (space)"}
									>
										<Show
											when={audio.isPlaying()}
											fallback={<HiSolidPlay size={22} />}
										>
											<HiSolidStop size={22} />
										</Show>
									</button>
								</div>
								<div class="save-status-group">
									<div
										class="save-status"
										data-state={session.state.saveStatus?.state}
										data-revision={session.state.saveStatus?.revision}
										title={`Revision ${session.state.saveStatus?.revision ?? 0}`}
									>
										{saveStatusLabel()}
									</div>
									<Show when={saveFailure()}>
										<div class="save-recovery" role="alert">
											<span class="save-recovery-message">
												{saveFailureMessage()}
											</span>
											<Show when={saveFailure()?.retryable}>
												<button
													type="button"
													class="save-retry-button"
													onClick={() => void session.retry()}
												>
													Retry
												</button>
											</Show>
										</div>
									</Show>
								</div>
							</header>
							<div class="workspace">
								<Show
									when={clip()}
									fallback={
										<p class="no-track">
											This project has no sampler track yet.
										</p>
									}
								>
									{(currentClip) => (
										<div class="track-editor">
											<div class="track-info">
												<span class="track-name">{track()?.name}</span>
												<Show when={packDependencyLabel()}>
													<span class="pack-dependency">
														Pack: {packDependencyLabel()}
													</span>
												</Show>
											</div>
											<StepGrid
												clip={currentClip()}
												dispatch={session.dispatch}
											/>
										</div>
									)}
								</Show>
							</div>
						</>
					)}
				</Match>
			</Switch>
		</main>
	);
}
