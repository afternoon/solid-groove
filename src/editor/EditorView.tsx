import {
	createMemo,
	createResource,
	createSignal,
	For,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import ArrangementView, {
	type PlacementEditingActions,
} from "../arrangement/ArrangementView";
import { getAudioRuntime } from "../audio/AudioRuntime";
import { clampTempo } from "../audio/Transport";
import { setParameter } from "../commands/definitions/parameters";
import type { NoteTrigger } from "../domain/entities";
import type { EventId } from "../domain/ids";
import { SONG_TEMPO } from "../domain/parameters";
import { TICKS_PER_QUARTER } from "../domain/time";
import type { PreviewEngine } from "../library/audition";
import LibraryBrowser from "../library/LibraryBrowser";
import { ToneAuditionEngine } from "../library/toneAuditionEngine";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { getProjectRepository } from "../projectRepositoryClient";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
import DrumMachinePanel from "./DrumMachinePanel";
import EditorHeader from "./EditorHeader";
import * as model from "./editorViewModel";
import LoopInfo from "./LoopInfo";
import Mixer from "./Mixer";
import type { PianoRollActions } from "./PianoRoll";
import ProjectLoadStates from "./ProjectLoadStates";
import { deleteSelectedNotes } from "./StepEditor";
import { playbackStep as playbackStepOf } from "./stepEditorModel";
import TrackEditor from "./TrackEditor";
import { useEditorSession } from "./useEditorSession";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { useProjectAudio } from "./useProjectAudio";
import "./EditorView.css";

export interface EditorViewProps {
	readonly projectId: string;
	/**
	 * Builds the audition engine each time the Library panel mounts. Defaults to
	 * a Tone-backed engine on the shared runtime; injected in tests so the
	 * per-mount lifecycle can be exercised without Web Audio.
	 */
	readonly createAuditionEngine?: () => PreviewEngine;
}

/**
 * The project editor: open a schema-v1 project, program its clip — on the
 * CLP-02 step editor for a sampler or drum machine, on the CLP-03 piano roll
 * for a synth's note clip — hear it, undo it, and let autosave save it. The
 * `FND-009` slice's minimal 16-step grid was replaced by `LOOP-010`'s full step
 * editor (`StepEditor`) and `LOOP-011`'s `PianoRoll`; the surrounding transport,
 * instrument panels, and save/undo wiring are the same path it established.
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
	// The piano roll owns its own note selection, but the KEY-01 registry — not
	// the roll — dispatches delete/duplicate/select-all. The roll hands its
	// operations up through `registerActions`; this holds them so the shortcut
	// handlers below can call them.
	const [pianoRollActions, setPianoRollActions] =
		createSignal<PianoRollActions | null>(null);
	// The arrangement's placement-editing controller (ARR-002), lifted here the
	// same way so the KEY-01 registry — not the arrangement view — dispatches
	// cut/copy/paste/delete/duplicate.
	const [arrangementEditingActions, setArrangementEditingActions] =
		createSignal<PlacementEditingActions | null>(null);
	// The step editor's note selection, lifted here so the `edit.delete` shortcut
	// can remove the same notes the grid shows highlighted (PRD KEY-01/CLP-02).
	const [selectedNoteIds, setSelectedNoteIds] = createSignal<
		readonly EventId[]
	>([]);
	const [libraryOpen, setLibraryOpen] = createSignal(false);
	const [packBrowserOpen, setPackBrowserOpen] = createSignal(false);

	// The packs this editing session has added on top of the project's own
	// derived dependencies; see `model.addedPackIds` for why they live for the
	// session only.
	const [sessionPackIds, setSessionPackIds] = createSignal<readonly string[]>(
		[],
	);
	const addedPackIds = createMemo(() =>
		model.addedPackIds(project(), sessionPackIds()),
	);

	// A fresh audition engine per panel mount, built off the shared runtime the
	// first time each opening browses. `LibraryBrowser`'s `useLibraryBrowser`
	// disposes the engine on unmount (its `AuditionController.dispose()` calls
	// `engine.dispose()`), and a disposed `ToneAuditionEngine` stays disposed —
	// so the engine must be owned per mount, never cached across panel opens, or
	// the second open would reuse a dead engine and every audition would fail
	// with `asset_missing` (LOOP-013). Auditions play through the same
	// destination the project does — never an export/offline context (LIB-01).
	const createAuditionEngine =
		props.createAuditionEngine ??
		(() => new ToneAuditionEngine(getAudioRuntime()));

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

	const playheadLabel = createMemo(() =>
		model.playheadLabel(audio.positionTicks()),
	);

	const track = createMemo(() => model.editedTrack(project()));
	const drumTrack = createMemo(() => model.drumTrack(project()));
	const sampleAssets = createMemo(() => model.sampleAssets(project()));
	const clip = createMemo(() => model.editedClip(project()));

	// The step editor's live playback-step indicator (CLP-02): which 16th step of
	// the edited clip the playhead is currently passing, wrapped within the clip's
	// bars, or null when stopped.
	const editorPlaybackStep = createMemo(() => {
		const currentClip = clip();
		if (!currentClip) return null;
		return playbackStepOf(
			currentClip,
			audio.positionTicks(),
			audio.isPlaying(),
		);
	});

	function deleteSelection(): void {
		const currentClip = clip();
		if (!currentClip) return;
		deleteSelectedNotes(currentClip, selectedNoteIds(), session.dispatch);
		setSelectedNoteIds([]);
	}

	const loopClips = createMemo(() => model.loopClips(project()));
	const instrument = createMemo(() => model.editedInstrument(project()));
	const showPianoRoll = createMemo(() => model.showPianoRoll(project()));

	// Plain function, not a memo: `hasSelection()` reads the controller's
	// internal (non-signal) state, so this must be re-evaluated live on every
	// call — the same reason `pianoRollActions()?.hasSelection()` is called
	// directly rather than memoized elsewhere in this file.
	const hasArrangementSelection = (): boolean =>
		!showPianoRoll() && (arrangementEditingActions()?.hasSelection() ?? false);

	const { shortcuts, editorContexts, keyHint } = useEditorShortcuts({
		audio,
		session,
		showPianoRoll,
		pianoRollActions,
		selectedNoteIds,
		deleteSelection,
		guideOpen,
		setGuideOpen,
		packBrowserOpen,
		arrangementEditingActions,
		hasArrangementSelection,
	});

	const instrumentPanelTrackId = createMemo(() =>
		model.instrumentPanelTrackId(project()),
	);
	const AUDITION_PITCH = 60; // Middle C
	const AUDITION_DURATION_TICKS = TICKS_PER_QUARTER;
	function auditionInstrument(): void {
		const currentTrack = track();
		const currentInstrument = instrument();
		if (!currentTrack || !currentInstrument) return;
		const trigger: NoteTrigger =
			currentInstrument.kind === "drumMachine" &&
			currentInstrument.pads.length > 0
				? { kind: "pad", padId: currentInstrument.pads[0].id }
				: { kind: "pitch", pitch: AUDITION_PITCH };
		void audio.auditionTrack(
			currentTrack.id,
			trigger,
			AUDITION_DURATION_TICKS,
			0.9,
		);
	}

	const sampleName = createMemo(() => model.sampleName(project()));
	const replacementOptions = createMemo(() =>
		model.replacementOptions(project()),
	);
	const packDependencyLabel = createMemo(() =>
		model.packDependencyLabel(project()),
	);

	const saveStatus = createMemo(() => session.state.saveStatus);

	return (
		<main class="editor">
			<Switch>
				<Match
					when={
						session.state.loading ||
						session.state.notFound ||
						session.state.error
					}
				>
					<ProjectLoadStates
						loading={session.state.loading}
						notFound={session.state.notFound}
						error={session.state.error}
					/>
				</Match>
				<Match when={project()}>
					{(currentProject) => (
						<>
							<EditorHeader
								projectName={currentProject().metadata.name}
								canUndo={session.state.canUndo}
								undoSummary={session.state.undoSummary}
								canRedo={session.state.canRedo}
								redoSummary={session.state.redoSummary}
								onUndo={() => session.undo()}
								onRedo={() => session.redo()}
								isPlaying={audio.isPlaying}
								onTogglePlay={() => void audio.toggle()}
								loopEnabled={audio.loopEnabled}
								onToggleLoop={() => audio.toggleLoop()}
								metronomeEnabled={audio.metronomeEnabled}
								onToggleMetronome={() => audio.toggleMetronome()}
								tempo={tempo}
								onTempoChange={applyTempo}
								timeSignature={timeSignature}
								playheadLabel={playheadLabel}
								libraryOpen={libraryOpen}
								onToggleLibrary={() => setLibraryOpen((open) => !open)}
								onOpenGuide={() => setGuideOpen(true)}
								keyHint={keyHint}
								saveStatus={saveStatus}
								onRetrySave={() => void session.retry()}
							/>
							<div class="arrangement-panel">
								<ArrangementView
									project={currentProject()}
									playheadTicks={audio.positionTicks}
									isPlaying={audio.isPlaying}
									dispatch={session.dispatch}
									beginGesture={session.beginGesture}
									onEditingActionsReady={setArrangementEditingActions}
								/>
							</div>
							<div class="editor-body">
								<Show when={libraryOpen()}>
									{/*
									 * One engine per mount: `Show` disposes and recreates this
									 * child branch on each false->true transition, so
									 * `createAuditionEngine()` runs once per open. Closing the
									 * panel unmounts `LibraryBrowser`, whose `useLibraryBrowser`
									 * disposes the engine — so each reopen must get a fresh,
									 * undisposed engine, never a cached (now-dead) one.
									 */}
									<aside class="library-panel" aria-label="Library">
										<LibraryBrowser
											previewEngine={createAuditionEngine()}
											addedPackIds={addedPackIds()}
											onAddPack={(pack) =>
												setSessionPackIds((previous) =>
													previous.includes(pack.id)
														? previous
														: [...previous, pack.id],
												)
											}
											onPackBrowserOpenChange={setPackBrowserOpen}
										/>
									</aside>
								</Show>
								<div class="workspace">
									<For each={loopClips()}>
										{(entry) => (
											<LoopInfo
												clip={entry.clip}
												asset={entry.asset}
												songTempo={tempo()}
											/>
										)}
									</For>
									<Show when={drumTrack()}>
										{(drum) => (
											<div class="drum-machine-editor">
												<div class="track-info">
													<span class={`track-name ${MASK_CONTENT}`}>
														{drum().name}
													</span>
												</div>
												<DrumMachinePanel
													track={drum()}
													assets={sampleAssets()}
													dispatch={session.dispatch}
													audition={(padId) =>
														void audio.auditionPad(drum().id, padId)
													}
												/>
											</div>
										)}
									</Show>
									<Show
										when={clip()}
										fallback={
											<p class="no-track">
												This project has no sampler track yet.
											</p>
										}
									>
										{(currentClip) => (
											<TrackEditor
												clip={currentClip()}
												trackName={track()?.name}
												packDependencyLabel={packDependencyLabel()}
												showPianoRoll={showPianoRoll}
												instrument={instrument()}
												dispatch={session.dispatch}
												beginGesture={session.beginGesture}
												editorPlaybackStep={editorPlaybackStep}
												selectedNoteIds={selectedNoteIds}
												setSelectedNoteIds={setSelectedNoteIds}
												project={currentProject()}
												playheadTicks={audio.positionTicks()}
												registerPianoRollActions={setPianoRollActions}
												instrumentPanelTrackId={instrumentPanelTrackId()}
												sampleName={sampleName()}
												replacementOptions={replacementOptions()}
												auditionInstrument={auditionInstrument}
											/>
										)}
									</Show>
									<Mixer
										project={currentProject()}
										dispatch={session.dispatch}
										beginGesture={session.beginGesture}
										trackLevelDb={audio.trackLevelDb}
										isPlaying={audio.isPlaying}
									/>
								</div>
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
