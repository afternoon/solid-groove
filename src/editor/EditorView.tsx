import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import ArrangementView, {
  type PlacementEditingActions,
} from "../arrangement/ArrangementView";
import { getAudioRuntime } from "../audio/AudioRuntime";
import { clampTempo } from "../audio/Transport";
import { setParameter } from "../commands/definitions/parameters";
import type { NoteTrigger } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { EventId, PlacementId, TrackId } from "../domain/ids";
import { SONG_TEMPO } from "../domain/parameters";
import { TICKS_PER_QUARTER } from "../domain/time";
import type { LibrarySample } from "../library/assetDrag";
import type { PreviewEngine } from "../library/audition";
import { loadSampleCommands, toLibrarySample } from "../library/insertion";
import type { LibraryClient } from "../library/libraryClient";
import { ToneAuditionEngine } from "../library/toneAuditionEngine";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { getProjectRepository } from "../projectRepositoryClient";
import {
  emptySelection,
  reconcileSelection,
  type SelectionState,
  selectOnly,
} from "../selection";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
import DrumMachinePanel from "./DrumMachinePanel";
import EditorHeader from "./EditorHeader";
import * as model from "./editorViewModel";
import {
  type EditorViewName,
  editorViewSpec,
  type ViewChangeSource,
} from "./editorViews";
import LibraryModal from "./LibraryModal";
import Mixer from "./Mixer";
import NewTrackButtons from "./NewTrackButtons";
import type { PianoRollActions } from "./PianoRoll";
import ProjectLoadStates from "./ProjectLoadStates";
import SequenceEditor from "./SequenceEditor";
import { deleteSelectedNotes } from "./StepEditor";
import { playbackStep as playbackStepOf } from "./stepEditorModel";
import TrackInstrument from "./TrackInstrument";
import { addTrackOfKind } from "./trackCreation";
import { useEditorSession } from "./useEditorSession";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { useProjectAudio } from "./useProjectAudio";
import ViewDock from "./ViewDock";
import "./EditorView.css";

export interface EditorViewProps {
  readonly projectId: string;
  /**
   * Which of the three views is on screen (`UI-001`). It comes from the URL —
   * the route decides, this component only renders — so a deep link opens that
   * view, the back button moves between them, and a reload returns to it.
   */
  readonly view: EditorViewName;
  /** Where each view lives, so the dock's entries are real addresses. */
  viewHref(view: EditorViewName): string;
  /** Navigates to a view. The editor asks; the route is what actually moves. */
  onSelectView(view: EditorViewName): void;
  /**
   * Builds the audition engine each time the Library panel mounts. Defaults to
   * a Tone-backed engine on the shared runtime; injected in tests so the
   * per-mount lifecycle can be exercised without Web Audio.
   */
  readonly createAuditionEngine?: () => PreviewEngine;
  /** Injected in tests; the browser fetches the delivered manifests otherwise. */
  readonly libraryClient?: LibraryClient;
  /** Injected in tests; the shared catalog-backed instance otherwise. */
  readonly analytics?: Analytics;
}

/** What the arrangement and the instrument view both show for an empty song. */
function NoTracks(): JSX.Element {
  return <p class="no-track">This project has no tracks yet. Add one in the mixer.</p>;
}

/** Mints IDs for tracks the arrangement creates. A module singleton. */
const factoryContext = createFactoryContext();

/**
 * The project editor: open a schema-v1 project, program its clip — on the
 * CLP-02 step editor for a sampler or drum machine, on the CLP-03 piano roll
 * for a synth's note clip — hear it, undo it, and let autosave save it. The
 * `FND-009` slice's minimal 16-step grid was replaced by `LOOP-010`'s full step
 * editor (`StepEditor`) and `LOOP-011`'s `PianoRoll`; the surrounding transport,
 * instrument panels, and save/undo wiring are the same path it established.
 */
export default function EditorView(props: EditorViewProps): JSX.Element {
  // An async computation, not a resource: `createResource` is gone in Solid 2,
  // and reading this memo before `getProjectRepository()` settles reports "not
  // ready" rather than a value. Only `useEditorSession`'s effect consumes it —
  // nothing renders from it — so the not-ready read suspends that effect and
  // never reaches a `Loading` boundary. That is the point: the editor's own
  // not-ready UI is the richer three-way `ProjectLoadStates` below (loading /
  // not found / load error) driven by `session.state`, and the previous
  // `repositoryResource() ?? null` was flattening "still loading" into "there
  // is no repository", which the hook could not tell from a real absence.
  const repository = createMemo(() => getProjectRepository());
  const session = useEditorSession(() => props.projectId, repository);

  const project = createMemo(() => session.state.project);
  const audio = useProjectAudio(project);
  const [guideOpen, setGuideOpen] = createSignal(false);

  // --- Views (UI-001) -------------------------------------------------------
  //
  // The view lives in the URL, so switching is a navigation and this component
  // holds no "current view" state to fall out of step with the address bar.
  // What it does hold is *how* the next switch was asked for, because the
  // address alone cannot say whether the dock, the keyboard, or the back button
  // moved you — and which entrypoint producers actually reach for is the
  // measure `view_changed` exists to take.
  let lastView: EditorViewName | undefined;
  let pendingVia: ViewChangeSource | null = null;

  function selectView(next: EditorViewName, via: ViewChangeSource): void {
    // Asking for the view you are already on is not a switch, so it neither
    // navigates nor logs — otherwise clicking the current dock entry twice
    // would report two switches that never happened.
    if (next === props.view) return;
    pendingVia = via;
    props.onSelectView(next);
  }

  // One event per switch, whatever moved: the dock and the keyboard set
  // `pendingVia` on their way through `selectView`, and anything else — the
  // back button, a deep link followed in-session — is `url` by elimination.
  // The first run only records where we arrived: opening a project is not a
  // switch, and `project_opened` already measures it.
  createEffect(
    // Both reactive reads are in the compute half, which is the only tracked
    // one: an `props.analytics` read moved into the apply half below would be
    // read once and never again.
    () => ({ view: props.view, analytics: props.analytics ?? defaultAnalytics }),
    ({ view, analytics }) => {
      const previous = lastView;
      lastView = view;
      const via = pendingVia ?? "url";
      pendingVia = null;
      if (previous === undefined || previous === view) return;
      analytics.log("view_changed", { view, via });
    },
  );

  // The piano roll owns its own note selection, but the KEY-01 registry — not
  // the roll — dispatches delete/duplicate/select-all. The roll hands its
  // operations up through `registerActions`; this holds them so the shortcut
  // handlers below can call them.
  const [pianoRollActions, setPianoRollActions] = createSignal<PianoRollActions | null>(
    null,
  );
  // The arrangement's placement-editing controller (ARR-002), lifted here the
  // same way so the KEY-01 registry — not the arrangement view — dispatches
  // cut/copy/paste/delete/duplicate.
  const [arrangementEditingActions, setArrangementEditingActions] =
    createSignal<PlacementEditingActions | null>(null);
  // The step editor's note selection, lifted here so the `edit.delete` shortcut
  // can remove the same notes the grid shows highlighted (PRD KEY-01/CLP-02).
  const [selectedNoteIds, setSelectedNoteIds] = createSignal<readonly EventId[]>([]);
  // The library is a window you open from the slot it is going to fill
  // (`UI-001`), not a column pinned open beside the arrangement. It starts
  // closed for the same reason the sequence editor does: the surface you came
  // for is the one that should be on screen.
  const [libraryOpen, setLibraryOpen] = createSignal(false);
  const [packBrowserOpen, setPackBrowserOpen] = createSignal(false);

  // The packs this editing session has added on top of the project's own
  // derived dependencies; see `model.addedPackIds` for why they live for the
  // session only.
  const [sessionPackIds, setSessionPackIds] = createSignal<readonly string[]>([]);
  const addedPackIds = createMemo(() => model.addedPackIds(project(), sessionPackIds()));

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
    (() => new ToneAuditionEngine(getAudioRuntime(), { songTempo: () => tempo() }));

  // Tempo is written by a validated command (song.tempo), clamped to the
  // AUD-02 40-240 BPM supported range at this surface. The command is the only
  // path: `useProjectAudio` mirrors `song.tempo` onto the transport on every
  // project change, so a running song re-times without restarting and without
  // this surface writing the tempo a second time.
  const tempo = createMemo(() => project()?.song.tempo ?? SONG_TEMPO.defaultValue);
  const timeSignature = createMemo(() => project()?.song.timeSignature ?? null);
  const applyTempo = (value: number) => {
    if (!Number.isFinite(value)) return;
    session.dispatch(
      setParameter({ scope: "song", parameterId: SONG_TEMPO.id }, clampTempo(value)),
    );
  };

  const playheadLabel = createMemo(() => model.playheadLabel(audio.positionTicks()));

  // Which track the editor is pointed at (#228). UI-only state held in the
  // shared PRD 9.2 selection model — never in the project — so one click moves
  // the clip editor, the instrument panel, and (once it lands) the device
  // chain together. Nothing is selected on arrival; `model.editedTrack` then
  // falls back to the project's first track.
  const [selection, setSelection] = createSignal<SelectionState>(emptySelection());
  // A track deleted by this session, an undo, or a remote edit must not leave
  // the editor pointed at it: `reconcileSelection` drops the dead scope, and
  // the fallback picks up from there.
  //
  // `project()` is the effect's only reactive read, so it is the whole compute
  // half; the `setSelection` write has to be in the apply half, which is the
  // only phase of an effect where a write is allowed.
  createEffect(
    () => project(),
    (current) => {
      if (!current) return;
      setSelection((state) => reconcileSelection(state, current));
    },
  );
  function selectTrack(trackId: TrackId): void {
    setSelection(selectOnly({ kind: "track", id: trackId }));
  }
  const selectedTrackId = createMemo(() => model.focusedTrackId(selection()));

  // Which placement's clip the sequence editor is open on (`UI-001`) — a
  // placement id, not a clip id: opening is a gesture on the timeline.
  const [openPlacementId, setOpenPlacementId] = createSignal<PlacementId | null>(null);
  const opened = createMemo(() => model.openedClip(project(), openPlacementId()));

  function openPlacement(placementId: PlacementId): void {
    setOpenPlacementId(placementId);
    const track = model.openedClip(project(), placementId)?.track;
    // Opening a clip is also saying "this track": the instrument view and the
    // mixer follow it, which is what keeps selection one piece of state.
    if (track) selectTrack(track.id);
  }

  const track = createMemo(() => model.editedTrack(project(), selectedTrackId()));
  const drumTrack = createMemo(() => model.drumTrack(track()));
  const sampleAssets = createMemo(() => model.sampleAssets(project()));
  /** The clip being programmed: the opened one, not the selection's. */
  const clip = createMemo(() => opened()?.clip ?? null);

  // The step editor's live playback-step indicator (CLP-02): which 16th step of
  // the edited clip the playhead is currently passing, wrapped within the clip's
  // bars, or null when stopped.
  const editorPlaybackStep = createMemo(() => {
    const currentClip = clip();
    if (!currentClip) return null;
    return playbackStepOf(currentClip, audio.positionTicks(), audio.isPlaying());
  });

  function deleteSelection(): void {
    const currentClip = clip();
    if (!currentClip) return;
    deleteSelectedNotes(currentClip, selectedNoteIds(), session.dispatch);
    setSelectedNoteIds([]);
  }

  const instrument = createMemo(() => model.editedInstrument(track()));
  const showPianoRoll = createMemo(() =>
    model.showPianoRoll(opened()?.track ?? null, clip()),
  );

  // Plain function, not a memo: `hasSelection()` reads the controller's
  // internal (non-signal) state, so this must be re-evaluated live on every
  // call — the same reason `pianoRollActions()?.hasSelection()` is called
  // directly rather than memoized elsewhere in this file.
  //
  // Deliberately *not* gated on `showPianoRoll()` (#258). `showPianoRoll()`
  // says which editor is mounted *below* the arrangement, not which surface
  // has focus, and the arrangement is on screen either way — so gating on it
  // made a placement selected on a synth track invisible to the shortcut
  // layer and undeletable. Which surface a selection-scoped shortcut acts on
  // is `useEditorShortcuts`' to decide, from the selections that exist.
  const hasArrangementSelection = (): boolean =>
    arrangementEditingActions()?.hasSelection() ?? false;

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
    // A true modal takes the keyboard, unlike the sequence editor: there is
    // nothing to do underneath the library while you pick a sound.
    libraryOpen,
    closeLibrary: () => setLibraryOpen(false),
    arrangementEditingActions,
    hasArrangementSelection,
    // `1`/`2`/`3` reach the same `selectView` the dock does, so the two
    // entrypoints cannot drift into different states (CF-008).
    selectView: (view) => selectView(view, "keyboard"),
    sequenceEditorOpen: () => opened() !== null,
    closeSequenceEditor: () => setOpenPlacementId(null),
  });

  const instrumentPanelTrackId = createMemo(() => model.instrumentPanelTrackId(track()));
  const AUDITION_PITCH = 60; // Middle C
  const AUDITION_DURATION_TICKS = TICKS_PER_QUARTER;
  function auditionInstrument(): void {
    const currentTrack = track();
    const currentInstrument = instrument();
    if (!currentTrack || !currentInstrument) return;
    const trigger: NoteTrigger =
      currentInstrument.kind === "drumMachine" && currentInstrument.pads.length > 0
        ? { kind: "pad", padId: currentInstrument.pads[0].id }
        : { kind: "pitch", pitch: AUDITION_PITCH };
    void audio.auditionTrack(currentTrack.id, trigger, AUDITION_DURATION_TICKS, 0.9);
  }

  const sampleName = createMemo(() => model.sampleName(project(), track()));

  /**
   * Loads a library sound onto the edited track's sampler — the one path both
   * the drag onto the instrument panel and the browser's "Insert" button take,
   * so the pointer gesture and its keyboard equivalent produce the same
   * transaction (PRD 9.3) and log the same event once (#225).
   *
   * `loadSampleCommands` carries the asset and points the sampler at it in one
   * transaction, so this is one revision and one undo. It is refused — leaving
   * the project untouched — when the edited track has no sampler to load into.
   */
  function loadLibrarySample(sample: LibrarySample): void {
    const currentProject = project();
    // The track the editor is pointed at (#228), not the project's first —
    // so a drop lands on whichever track the user selected.
    const trackId = model.samplerTrackId(track());
    if (!currentProject || !trackId) return;
    const result = session.dispatch(
      loadSampleCommands(currentProject, trackId, sample, createFactoryContext()),
    );
    if (!result?.ok) return;
    const analytics = props.analytics ?? defaultAnalytics;
    analytics.log("instrument_changed", { instrument_type: "sampler" });
    analytics.logFeatureFirstUse("sampler");
  }

  const packDependencyLabel = createMemo(() => model.packDependencyLabel(project()));

  const saveStatus = createMemo(() => session.state.saveStatus);

  return (
    <main class="editor">
      <Switch>
        <Match
          when={session.state.loading || session.state.notFound || session.state.error}
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
                onOpenGuide={() => setGuideOpen(true)}
                keyHint={keyHint}
                saveStatus={saveStatus}
                onRetrySave={() => void session.retry()}
              />
              <div class="editor-body">
                {/*
                 * One view at a time (`UI-001`). A view you are not on is not
                 * on the page at all rather than hidden behind the one you
                 * are — the bet this change exists to test.
                 */}
                <Switch>
                  <Match when={props.view === "arrangement"}>
                    <div class="editor-main">
                      {/* The arrangement's own way to add a track (`UI-001`),
                          the same unit and the same route the mixer uses. */}
                      <div class="arrangement-new-track">
                        <NewTrackButtons
                          label="Add track to the arrangement"
                          onAdd={(spec) =>
                            addTrackOfKind(spec.kind, {
                              project: currentProject(),
                              context: factoryContext,
                              dispatch: session.dispatch,
                              analytics: props.analytics ?? defaultAnalytics,
                              feature: "arrangement",
                              onSelect: selectTrack,
                            })
                          }
                        />
                      </div>
                      <div class="arrangement-panel">
                        <ArrangementView
                          project={currentProject()}
                          playheadTicks={audio.positionTicks}
                          isPlaying={audio.isPlaying}
                          dispatch={session.dispatch}
                          beginGesture={session.beginGesture}
                          onEditingActionsReady={setArrangementEditingActions}
                          selectedTrackId={track()?.id ?? null}
                          onSelectTrack={selectTrack}
                          onOpenPlacement={openPlacement}
                        />
                      </div>
                      <Show when={currentProject().song.tracks.length === 0}>
                        <NoTracks />
                      </Show>
                    </div>
                  </Match>
                  <Match when={props.view === "instrument"}>
                    <div class="instrument-view">
                      <Show when={track()} fallback={<NoTracks />}>
                        {(currentTrack) => (
                          <>
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
                            <TrackInstrument
                              trackName={currentTrack().name}
                              instrument={instrument()}
                              project={currentProject()}
                              trackId={instrumentPanelTrackId()}
                              sampleName={sampleName()}
                              loadSample={loadLibrarySample}
                              audition={auditionInstrument}
                              onBrowse={() => setLibraryOpen(true)}
                              dispatch={session.dispatch}
                              beginGesture={session.beginGesture}
                            />
                          </>
                        )}
                      </Show>
                    </div>
                  </Match>
                  <Match when={props.view === "mixer"}>
                    <div class="mixer-view">
                      <Mixer
                        project={currentProject()}
                        analytics={props.analytics}
                        dispatch={session.dispatch}
                        beginGesture={session.beginGesture}
                        trackLevelDb={audio.trackLevelDb}
                        isPlaying={audio.isPlaying}
                        selectedTrackId={track()?.id ?? null}
                        onSelectTrack={selectTrack}
                      />
                    </div>
                  </Match>
                </Switch>
              </div>
              {/*
               * The library, opened from the slot it will fill (`UI-001`). A
               * fresh audition engine per open: `Show` disposes this branch on
               * close and `useLibraryBrowser` disposes the engine with it, so
               * a cached one would be dead on the second open (LOOP-013).
               */}
              <Show when={libraryOpen()}>
                <LibraryModal
                  client={props.libraryClient}
                  previewEngine={createAuditionEngine()}
                  analytics={props.analytics}
                  onInsert={(asset) => {
                    const sample = toLibrarySample(asset);
                    if (sample) loadLibrarySample(sample);
                    // Inserting is what you opened it for, so it closes.
                    setLibraryOpen(false);
                  }}
                  addedPackIds={addedPackIds()}
                  onAddPack={(pack) =>
                    setSessionPackIds((previous) =>
                      previous.includes(pack.id) ? previous : [...previous, pack.id],
                    )
                  }
                  onPackBrowserOpenChange={setPackBrowserOpen}
                  onClose={() => setLibraryOpen(false)}
                />
              </Show>
              {/* The sequence editor, over whichever view opened it
                  (`UI-001`). Keyed on the placement, so deleting or undoing
                  one closes the editor rather than leaving it on a clip the
                  project no longer places. */}
              <Show when={opened()}>
                {(open) => (
                  <SequenceEditor
                    clip={open().clip}
                    track={open().track}
                    project={currentProject()}
                    packDependencyLabel={packDependencyLabel()}
                    showPianoRoll={showPianoRoll}
                    loop={model.loopEntryFor(currentProject(), open().clip)}
                    songTempo={tempo()}
                    editorPlaybackStep={editorPlaybackStep}
                    selectedNoteIds={selectedNoteIds}
                    setSelectedNoteIds={setSelectedNoteIds}
                    playheadTicks={audio.positionTicks()}
                    registerPianoRollActions={setPianoRollActions}
                    dispatch={session.dispatch}
                    beginGesture={session.beginGesture}
                    onClose={() => setOpenPlacementId(null)}
                  />
                )}
              </Show>
              <ViewDock
                view={props.view}
                href={props.viewHref}
                onSelect={(view) => selectView(view, "dock")}
                keyHint={(view) => keyHint(editorViewSpec(view).actionId)}
              />
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
