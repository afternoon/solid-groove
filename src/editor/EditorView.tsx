import { A } from "@solidjs/router";
import {
	HiSolidArrowPathRoundedSquare,
	HiSolidArrowUturnLeft,
	HiSolidArrowUturnRight,
	HiSolidMusicalNote,
	HiSolidPlay,
	HiSolidQuestionMarkCircle,
	HiSolidSquares2x2,
	HiSolidStop,
} from "solid-icons/hi";
import {
	createMemo,
	createResource,
	createSignal,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import { clampTempo, MAX_TEMPO_BPM, MIN_TEMPO_BPM } from "../audio/Transport";
import { setParameter } from "../commands/definitions/parameters";
import ProjectNotFound from "../components/ProjectNotFound";
import TapeLoader from "../components/TapeLoader";
import { SONG_TEMPO } from "../domain/parameters";
import { formatBarsBeatsSixteenths } from "../domain/time";
import type { SaveFailureReason } from "../persistence/projectRepository";
import { getProjectRepository } from "../projectRepositoryClient";
import type { ShortcutContext, ShortcutHandlers } from "../shortcuts";
import { shortcutLabel, useShortcuts } from "../shortcuts";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
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
	const [guideOpen, setGuideOpen] = createSignal(false);

	// Tempo is written by a validated command (song.tempo), clamped to the
	// AUD-02 40-240 BPM supported range at this surface. The command is the only
	// path: `useProjectAudio` mirrors `song.tempo` onto the transport on every
	// project change, so a running song re-times without restarting and without
	// this surface writing the tempo a second time.
	const tempo = createMemo(
		() => project()?.song.tempo ?? SONG_TEMPO.defaultValue,
	);
	const timeSignature = createMemo(() => project()?.song.timeSignature ?? null);
	const applyTempo = (value: number) => {
		if (!Number.isFinite(value)) return;
		session.dispatch(
			setParameter(
				{ scope: "song", parameterId: SONG_TEMPO.id },
				clampTempo(value),
			),
		);
	};

	const playheadLabel = createMemo(() => {
		const bbs = formatBarsBeatsSixteenths(audio.positionTicks());
		// Show a 1-based bar:beat for a musician, dropping the sixteenth fraction.
		const [bars, beats] = bbs.split(":");
		return `${Number(bars) + 1}.${Number(beats) + 1}`;
	});

	// The KEY-01 registry owns every mapping; this component only says which
	// actions exist here and what they do. An action the slice does not
	// implement yet simply has no handler and never fires.
	const handlers = (): ShortcutHandlers => ({
		"transport.play_stop": { run: () => void audio.toggle() },
		// Shift+Space resumes from where playback last stopped, exactly as the
		// registry describes it — not a second play/stop toggle.
		"transport.continue": { run: () => void audio.continueFromStop() },
		"transport.metronome": { run: () => audio.toggleMetronome() },
		"edit.undo": {
			run: () => session.undo(),
			isEnabled: () => session.state.canUndo,
		},
		"edit.redo": {
			run: () => session.redo(),
			isEnabled: () => session.state.canRedo,
		},
		"help.shortcut_guide": { run: () => setGuideOpen(true) },
		"view.close_surface": {
			run: () => setGuideOpen(false),
			isEnabled: () => guideOpen(),
		},
	});

	// The surfaces this slice actually shows. The guide filters against these,
	// so "shortcuts valid in the current context" means the editor underneath
	// rather than the modal covering it.
	const editorContexts = (): readonly ShortcutContext[] => [
		"editor",
		"step_editor",
	];

	// While the guide is open it is the only active context, so nothing behind
	// it can fire — including playback and selection (PRD KEY-02).
	const contexts = (): readonly ShortcutContext[] =>
		guideOpen() ? ["dialog"] : editorContexts();

	const shortcuts = useShortcuts({ handlers, contexts });
	const keyHint = (action: Parameters<typeof shortcutLabel>[0]) =>
		shortcutLabel(action, shortcuts.platform);

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
								<A
									class="back-to-projects"
									href="/dashboard"
									aria-label="Projects"
									title="Projects"
								>
									<HiSolidSquares2x2 size={18} />
								</A>
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
										title={`${session.state.undoSummary ?? "Undo"} (${keyHint("edit.undo")})`}
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
										title={`${session.state.redoSummary ?? "Redo"} (${keyHint("edit.redo")})`}
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
										title={`${audio.isPlaying() ? "Stop" : "Play"} (${keyHint(
											"transport.play_stop",
										)})`}
									>
										<Show
											when={audio.isPlaying()}
											fallback={<HiSolidPlay size={22} />}
										>
											<HiSolidStop size={22} />
										</Show>
									</button>
									<button
										type="button"
										class="loop-toggle"
										onClick={() => audio.toggleLoop()}
										aria-pressed={audio.loopEnabled()}
										aria-label={
											audio.loopEnabled() ? "Disable loop" : "Enable loop"
										}
										title={audio.loopEnabled() ? "Disable loop" : "Enable loop"}
									>
										<HiSolidArrowPathRoundedSquare size={18} />
									</button>
									<button
										type="button"
										class="metronome-toggle"
										onClick={() => audio.toggleMetronome()}
										aria-pressed={audio.metronomeEnabled()}
										aria-label={
											audio.metronomeEnabled()
												? "Disable metronome"
												: "Enable metronome"
										}
										title={`Metronome (${keyHint("transport.metronome")})`}
									>
										<HiSolidMusicalNote size={18} />
									</button>
									<div class="tempo-control">
										{/* The label is the input's only accessible name — no
										    aria-label to override it — and the unit is decorative
										    text the name already carries. */}
										<label class="visually-hidden" for="tempo-input">
											Tempo (BPM)
										</label>
										<input
											id="tempo-input"
											type="number"
											class="tempo-input"
											min={MIN_TEMPO_BPM}
											max={MAX_TEMPO_BPM}
											step={1}
											value={tempo()}
											onChange={(event) =>
												applyTempo(event.currentTarget.valueAsNumber)
											}
										/>
										<span class="tempo-unit" aria-hidden="true">
											BPM
										</span>
									</div>
									<Show when={timeSignature()}>
										{(signature) => (
											<span
												class="time-signature"
												title="Time signature (fixed at 4/4)"
											>
												<span class="visually-hidden">Time signature </span>
												{signature().numerator}/{signature().denominator}
											</span>
										)}
									</Show>
									<span class="playhead-position" title="Playhead (bar.beat)">
										<span class="visually-hidden">Playhead at bar </span>
										{playheadLabel()}
									</span>
								</div>
								<button
									type="button"
									class="shortcut-guide-button"
									aria-label="Keyboard shortcuts"
									title={`Keyboard shortcuts (${keyHint("help.shortcut_guide")})`}
									onClick={() => setGuideOpen(true)}
								>
									<HiSolidQuestionMarkCircle size={18} />
								</button>
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
							<Show when={guideOpen()}>
								<ShortcutGuide
									contexts={editorContexts()}
									platform={shortcuts.platform}
									isEnabled={(id) => shortcuts.isEnabled(id)}
									onClose={() => setGuideOpen(false)}
								/>
							</Show>
						</>
					)}
				</Match>
			</Switch>
		</main>
	);
}
