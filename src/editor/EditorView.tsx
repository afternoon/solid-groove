import { Title } from "@solidjs/meta";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  snapshot,
} from "solid-js";
import { pageTitle } from "../../site.config.mjs";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import ArrangementView from "../arrangement/ArrangementView";
import { getAudioRuntime } from "../audio/AudioRuntime";
import { provideStoredAudio } from "../audio/storedAudio";
import { type CapabilityReport, FULLY_CAPABLE } from "../browser/capabilities";
import { reportMissingCapabilities } from "../browser/reportCapabilities";
import { renameProject } from "../commands/definitions/project";
import { ControlRegistryContext } from "../controls/control";
import { createControlRegistry } from "../controls/registry";
import type { NoteTrigger, Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { PlacementId } from "../domain/ids";
import { TICKS_PER_QUARTER } from "../domain/time";
import {
  type SampleSlotTargeting,
  SampleSlotTargetingContext,
} from "../instrument/sampleSlotTargeting";
import type { PreviewEngine } from "../library/audition";
import { type LibraryClient, sharedLibraryClient } from "../library/libraryClient";
import type { LibraryAsset } from "../library/manifest";
import { ToneAuditionEngine } from "../library/toneAuditionEngine";
import { getProjectRepository } from "../projectRepositoryClient";
import type { ArrangementSelection } from "../selection";
import { timeoutScheduler } from "../shared/scheduler";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
import { getUserLibraryRepository } from "../userLibrary/userLibraryClient";
import type { UserLibraryRepository } from "../userLibrary/userLibraryRepository";
import { userPackAvailability } from "../userLibrary/userPacks";
import { type UserLibraryAccount, useUserLibrary } from "../userLibrary/useUserLibrary";
import AssistantPanel from "./assistant/AssistantPanel";
import { useAssistantPanel } from "./assistant/useAssistantPanel";
import CompatibilityNotice from "./CompatibilityNotice";
import { compatibilityNoticeItems } from "./compatibilityNoticeItems";
import { DeviceSpectrumContext, type DeviceSpectrumSource } from "./deviceSpectrum";
import EditorHeader from "./EditorHeader";
import EditorInstrument from "./EditorInstrument";
import EmptyView from "./EmptyView";
import {
  createEditorControls,
  type EditorControls,
  EditorControlsContext,
  type EditorLocation,
} from "./editorControls";
import * as model from "./editorViewModel";
import { type EditorViewName, editorViewSpec } from "./editorViews";
import LibraryEmpty from "./LibraryEmpty";
import LibraryModal from "./LibraryModal";
import LoadRecoveryNotice from "./LoadRecoveryNotice";
import {
  type LibraryTarget,
  targetAssetTypes,
  targetPath,
  targetSound,
} from "./libraryTarget";
import MissingSounds from "./MissingSounds";
import Mixer from "./Mixer";
import NewTrackButtons from "./NewTrackButtons";
import ProjectLoadStates from "./ProjectLoadStates";
import { selectedPadOf } from "./padSelection";
import SequenceEditor from "./SequenceEditor";
import {
  type AddTrackHost,
  addTrackOfKind,
  type NewTrackKindSpec,
} from "./trackCreation";
import { deleteTrack, type TrackDeletionContext } from "./trackDeletion";
import { useEditingSurfaces } from "./useEditingSurfaces";
import { useEditorNavigation } from "./useEditorNavigation";
import { useEditorSession } from "./useEditorSession";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { useLibraryTarget } from "./useLibraryTarget";
import { useProjectAudio } from "./useProjectAudio";
import { useSongControls } from "./useSongControls";
import { useTrackSelection } from "./useTrackSelection";
import ViewDock from "./ViewDock";
import "./EditorView.css";

export interface EditorViewProps {
  readonly projectId: string;
  /**
   * Which view is on screen (`UI-001`, `UI-002`). It comes from the URL —
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
  /** The header's account control (#951), supplied by the route. */
  readonly account?: JSX.Element;
  /**
   * What this browser can do (#75). The route passes the live detection;
   * omitted, the browser is taken as fully capable and nothing is explained.
   */
  readonly capabilities?: CapabilityReport;
  /**
   * Hands over the editor's controls (`UI-004`) once, for a surface that is
   * not under the editor and so cannot `useEditorControls()` — and for tests.
   */
  onControlsReady?(controls: EditorControls): void;
  /**
   * Who is signed in, for the personal library (#282). A guest, or no one,
   * sees My packs but is offered an account when they try to use it.
   */
  readonly libraryAccount?: UserLibraryAccount | null;
  /** Injected in tests; Firestore and Cloud Storage (or memory) otherwise. */
  readonly userLibraryRepository?: () => Promise<UserLibraryRepository>;
}

/** What the arrangement and the instrument view both show for an empty song. */
function NoTracks(): JSX.Element {
  return <p class="no-track">This project has no tracks yet. Add one in the mixer.</p>;
}

/** What the sounds view opens on, for each Library target (LIB-010). */
const SLOT_KINDS: Record<LibraryTarget["kind"], "drum-pad" | "sampler" | "loop-track"> = {
  pad: "drum-pad",
  sampler: "sampler",
  loop: "loop-track",
  "new-track": "loop-track",
  "new-pad": "drum-pad",
};

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

  // The open project as the plain, immutable `Project` the command layer
  // produced, not the session store's proxy over it (#844). A `Project` is
  // never edited in place: every change is a whole new revision written to
  // `state.project`, so this memo re-runs on every change and nothing gains
  // from the store's per-property tracking. Handing out the proxy instead made
  // every effect that reacts to the project (audio wiring, selection
  // reconciliation) read store properties in its untracked apply half, and
  // Solid's dev build logged STRICT_READ_UNTRACKED for each one, hundreds per
  // edit. `snapshot` is identity-preserving here (the store never writes into a
  // `Project`), so structural sharing between revisions survives intact.
  const project = createMemo(() => {
    const current = session.state.project;
    return current ? snapshot(current) : null;
  });
  const audio = useProjectAudio(project);
  const capabilities = () => props.capabilities ?? FULLY_CAPABLE;
  // Once per capability per browser (`logOnce`), so re-running on a
  // different report or analytics instance costs nothing (#75).
  createEffect(
    () => ({ report: capabilities(), analytics: props.analytics ?? defaultAnalytics }),
    ({ report, analytics }) => reportMissingCapabilities(report, analytics),
  );
  const spectrumSource: DeviceSpectrumSource = {
    isPlaying: () => audio.isPlaying(),
    read: (deviceId) => audio.readDeviceSpectrum(deviceId),
  };
  const [guideOpen, setGuideOpen] = createSignal(false);
  // The editor's controls by address, and their marks (`UI-004`): every part
  // under the editor registers here when it mounts. UI-only, like selection.
  const controls = createControlRegistry();

  const analytics = () => props.analytics ?? defaultAnalytics;
  // The views (UI-001): switching is a navigation, logged as `view_changed`.
  const navigation = useEditorNavigation({
    view: () => props.view,
    onSelectView: (view) => props.onSelectView(view),
    analytics,
  });
  const { selectView } = navigation;

  // The Export dialog is a modal over the editor, so the editor's keys stand down.
  const [exportOpen, setExportOpen] = createSignal(false);

  // A fresh audition engine per panel mount, built off the shared runtime the
  // first time each opening browses. `LibraryBrowser`'s `useLibraryBrowser`
  // disposes the engine on unmount (its `AuditionController.dispose()` calls
  // `engine.dispose()`), and a disposed `ToneAuditionEngine` stays disposed —
  // so the engine must be owned per mount, never cached across panel opens, or
  // the second open would reuse a dead engine and every audition would fail
  // with `asset_missing` (LOOP-013). Auditions play through the same
  // destination the project does — never an export/offline context (LIB-01).
  // The one shared library client, so the Library view and the
  // pack-upgrade check (#892) share its cached index and manifests.
  const libraryClient = props.libraryClient ?? sharedLibraryClient();
  // The producer's own packs (#282). Held by the editor, not the library
  // view, so an import keeps going after you leave the Library view.
  const loadUserLibrary = props.userLibraryRepository ?? getUserLibraryRepository;
  const userLibrary = useUserLibrary({
    account: () => props.libraryAccount ?? null,
    analytics: props.analytics,
    repository: loadUserLibrary,
  });
  // A personal sound has no URL: playback and audition read its bytes from
  // where it is stored, as the signed-in user, through the same repository.
  onCleanup(
    provideStoredAudio(async (storageRef) =>
      (await loadUserLibrary()).readAudio(storageRef),
    ),
  );
  // The personal sounds this project uses that are gone from the producer's
  // packs (#282), named with the tracks and clips they leave silent. Judged
  // only once the packs have loaded, so nothing reads as missing while they
  // are on their way, and again whenever the project or the packs change.
  const missingSounds = createMemo(() => {
    const current = project();
    const owner = props.libraryAccount?.uid;
    if (!current || !owner || userLibrary.status() !== "ready") return null;
    const report = userPackAvailability(current, userLibrary.packs(), owner);
    return report.missingAssets.length + report.missingPacks.length > 0 ? report : null;
  });
  const userPackName = (packId: string): string | null =>
    userLibrary.packs().find((pack) => pack.id === packId)?.name ?? null;
  /** Whether the open project uses a sound: its stored audio is one of the song's. */
  const projectUses = (asset: LibraryAsset): boolean =>
    asset.storageRef !== undefined &&
    (project()?.song.assets.some((used) => used.storageRef === asset.storageRef) ??
      false);

  const createAuditionEngine =
    props.createAuditionEngine ??
    (() => new ToneAuditionEngine(getAudioRuntime(), { songTempo: () => song.tempo() }));

  // Tempo, swing and the loop: song state the header and the transport keys
  // write through commands.
  const song = useSongControls({ project, session, analytics });

  // Which track, pad and clip the editor is pointed at (#228, #643), and the
  // return the mixer pointed it at (#386): UI-only state with one owner for
  // every write to it. Pointing at a track or a pad ends a new-track or
  // new-pad aim.
  const trackSelection = useTrackSelection({
    project,
    // `library` is declared below: this runs on a user's selection, never
    // during setup.
    onPoint: () => library.endNewAim(),
  });
  const {
    selectTrack,
    chooseTrack,
    selectTrackFrom,
    selectedTrackId,
    deletableTrackId,
    opened,
    selectPlacement,
    track,
    drumTrack,
    padSelection,
    selectPad,
    selectedReturn,
    selectReturn,
  } = trackSelection;
  const trackDeletion: TrackDeletionContext = {
    project,
    dispatch: (commands) => session.dispatch(commands),
    select: selectTrack,
    get analytics() {
      return props.analytics ?? defaultAnalytics;
    },
  };

  // What the editing surfaces hand up so the shortcut layer can act on them.
  const {
    pianoRollActions,
    setPianoRollActions,
    arrangementEditingActions,
    setArrangementEditingActions,
    setLoopBraceFocused,
    loopBraceFocused,
    selectedNoteIds,
    setSelectedNoteIds,
    editorPlaybackStep,
    showPianoRoll,
    deleteSelection,
    selectAllSteps,
    hasArrangementSelection,
  } = useEditingSurfaces({ opened, audio, session });

  // The arrangement's own selection, kept while another view is on screen:
  // the arrangement is rebuilt on the way back and starts from it, so the
  // clip you selected is still highlighted (`UI-002`). Read only on mount, so
  // a plain variable rather than a signal.
  let arrangementSelection: ArrangementSelection | null = null;
  /** Selects a placement's clip and goes to `2` with it (`UI-002`). */
  function openPlacement(placementId: PlacementId): void {
    selectPlacement(placementId);
    selectView("sequence", "arrangement");
  }

  // Where the Library is aimed and what inserting from it does (`UI-002`).
  const library = useLibraryTarget({
    project,
    view: () => props.view,
    session,
    analytics,
    selection: trackSelection,
    navigation,
    audio,
    client: libraryClient,
    heldPacks: userLibrary.heldPack,
  });

  /** What a dock tile's tip says its view will open (`UI-002`). */
  function dockOpens(view: EditorViewName): string | undefined {
    if (view === "sequence") return opened()?.clip.name;
    if (view === "instrument") return track()?.name;
    if (view !== "library") return undefined;
    const target = library.target();
    if (target?.kind === "new-track") return "loops for a new track";
    return target ? `sounds for ${track()?.name ?? "the track"}` : undefined;
  }

  /** What every sample slot shows of the Library's aim (`UI-002`). */
  const slotTargeting: SampleSlotTargeting = {
    get keyLabel() {
      return keyHint("view.show_library");
    },
    isTarget: (slot) => library.isTarget(slot),
  };

  const sampleAssets = createMemo(() => model.sampleAssets(project()));

  // Finding and showing a control by its address (`UI-004`). A reveal moves
  // only UI state — the view (a navigation, logged as `reveal`), the
  // selection, the clip `2` edits — and hands back where the editor was, so
  // the caller can put it back. Nothing here reaches the project, its history
  // or a save.
  const editorControls = createEditorControls({
    registry: controls,
    project,
    location: (): EditorLocation => ({
      view: props.view,
      ...trackSelection.location(),
    }),
    goTo(home) {
      if (home.view) selectView(home.view, "reveal");
      if (home.trackId) {
        selectTrack(home.trackId);
        if (home.padId) selectPad(home.trackId, home.padId);
      }
      if (home.placementId !== undefined) selectPlacement(home.placementId);
    },
    restore(location) {
      selectView(location.view, "reveal");
      trackSelection.restore(location);
    },
    scheduler: timeoutScheduler,
  });
  onCleanup(() => editorControls.dispose());
  props.onControlsReady?.(editorControls);
  const instrument = createMemo(() => model.editedInstrument(track()));
  // The assistant's panel (#849): where it is and how big, remembered on this
  // device. One per editor, shared by the panel, the header's button and the
  // shortcut layer.
  const assistant = useAssistantPanel({ analytics: () => props.analytics });
  // Docked, the editor's views leave the panel's column free (EditorView.css).
  const assistantDockSpace = () =>
    assistant.layout().mode === "docked" ? `${assistant.layout().width}px` : "0px";

  const { shortcuts, editorContexts, keyHint } = useEditorShortcuts({
    assistant,
    audio,
    session,
    showPianoRoll,
    pianoRollActions,
    selectedNoteIds,
    deleteSelection,
    selectAllSteps,
    guideOpen,
    setGuideOpen,
    exportOpen,
    libraryOpen: library.isOpen,
    returnFromInsert: () => library.returnFromInsert("keyboard"),
    libraryActions: library.actions,
    arrangementEditingActions,
    hasArrangementSelection,
    // `1`-`5` reach the same `selectView` the dock does, so the two
    // entrypoints cannot drift into different states (CF-008).
    selectView: (view) => selectView(view, "keyboard"),
    sequenceEditorOpen: () => props.view === "sequence" && opened() !== null,
    openSelectedClip: () => {
      const ids = arrangementEditingActions()?.getSelection() ?? [];
      return ids.length === 1 ? () => openPlacement(ids[0]) : undefined;
    },
    toggleLooping: song.toggleLoop,
    loopBraceFocused,
    moveLoop: song.moveLoop,
    resizeLoop: song.resizeLoop,
    // The mixer keeps the arrows: its strips are moved with them (#447).
    adjacentTrack: (by) => {
      if (props.view === "mixer") return undefined;
      const id = model.adjacentTrackId(project(), selectedTrackId(), by);
      return id ? () => chooseTrack(id) : undefined;
    },
    // Backspace on the selected track (#537), where its header's trash button
    // is: not the mixer, and not in the sequence view. Only a track the user
    // chose through its header (#960) — not the first-track fallback, and not
    // one a lane click, a clip click or a deleted clip left selected — so a
    // slip never takes a whole track. Nor in the instrument view's return
    // mode, where the track is not on screen at all (#386).
    deleteSelectedTrack: () => {
      const id = deletableTrackId();
      if (props.view === "mixer" || props.view === "sequence" || id === null)
        return undefined;
      if (props.view === "instrument" && selectedReturn() !== null) return undefined;
      if (!project()?.song.tracks.some((candidate) => candidate.id === id))
        return undefined;
      return () => deleteTrack(trackDeletion, id);
    },
    dropTrackChoice: () =>
      deletableTrackId() === null ? undefined : trackSelection.dropTrackChoice,
  });

  /** An empty screen's way out: a view, named and keyed as the dock names it. */
  const viewFix = (view: EditorViewName) => ({
    view,
    label: editorViewSpec(view).label,
    keyLabel: keyHint(editorViewSpec(view).actionId),
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

  /** Adds a track of the chosen kind, through the route the arrangement's
   * buttons take, and selects it (#495). */
  function addTrack(
    current: Project,
    spec: NewTrackKindSpec,
    feature: AddTrackHost["feature"] = "arrangement",
  ): void {
    addTrackOfKind(spec.kind, {
      project: current,
      context: factoryContext,
      dispatch: session.dispatch,
      analytics: props.analytics ?? defaultAnalytics,
      feature,
      onSelect: selectTrack,
    });
  }

  return (
    <ControlRegistryContext value={controls}>
      <EditorControlsContext value={editorControls}>
        <main
          class={["editor", `editor-${props.view}`]}
          style={{ "--assistant-dock-space": assistantDockSpace() }}
        >
          <Switch>
            <Match
              when={
                session.state.loading || session.state.notFound || session.state.error
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
                  <Title>{pageTitle(currentProject().metadata.name)}</Title>
                  <EditorHeader
                    projectName={currentProject().metadata.name}
                    onRename={(name) => session.dispatch(renameProject(name))}
                    session={session}
                    audio={audio}
                    onToggleLoop={song.toggleLoop}
                    tempo={song.tempo}
                    onTempoChange={song.applyTempo}
                    swing={song.swing}
                    onSwingInput={song.swingInput}
                    onSwingCommit={song.commitSwing}
                    onOpenGuide={() => setGuideOpen(true)}
                    onExportOpenChange={setExportOpen}
                    keyHint={keyHint}
                    account={props.account}
                    assistant={{
                      open: () => assistant.layout().mode !== "closed",
                      ariaKeys: shortcuts.platform === "mac" ? "Meta+K" : "Control+K",
                      toggle: (opener) => assistant.toggle(opener),
                      bindLauncher: (element) => assistant.bindLauncher(element),
                    }}
                  />
                  <CompatibilityNotice
                    items={compatibilityNoticeItems(capabilities(), audio.startFailure())}
                  />
                  <LoadRecoveryNotice
                    droppedPlacements={session.state.droppedPlacements}
                  />
                  <Show when={missingSounds()}>
                    {(report) => (
                      <MissingSounds report={report()} packName={userPackName} />
                    )}
                  </Show>
                  {/* The views' device panels draw live spectra from playback (LOOP-022). */}
                  <DeviceSpectrumContext value={spectrumSource}>
                    <div class="editor-body">
                      {/*
                       * One view at a time (`UI-001`). A view you are not on is not
                       * on the page at all rather than hidden behind the one you
                       * are — the bet this change exists to test.
                       */}
                      <Switch>
                        <Match when={props.view === "arrangement"}>
                          <div class="editor-main">
                            <div class="arrangement-panel">
                              <ArrangementView
                                project={currentProject()}
                                playheadTicks={audio.positionTicks}
                                isPlaying={audio.isPlaying}
                                trackLevel={audio.trackLevel}
                                dispatch={session.dispatch}
                                beginGesture={session.beginGesture}
                                onEditingActionsReady={setArrangementEditingActions}
                                selectedTrackId={track()?.id ?? null}
                                chosenTrackId={deletableTrackId()}
                                onSelectTrack={selectTrackFrom}
                                onOpenPlacement={openPlacement}
                                onSelectPlacement={selectPlacement}
                                initialSelection={arrangementSelection}
                                onSelectionChange={(selected) => {
                                  arrangementSelection = selected;
                                }}
                                onLoopBraceFocusChange={setLoopBraceFocused}
                                /* The arrangement's own way to add a track
                             (`UI-001`), the same unit and the same route the
                             mixer uses — rendered by the arrangement directly
                             below the last track, where the next one would
                             go, rather than in a band above the timeline. */
                                belowTracks={
                                  <NewTrackButtons
                                    label="Add track to the arrangement"
                                    onAdd={(spec) => addTrack(currentProject(), spec)}
                                    onAddLoop={() =>
                                      library.aim("arrangement", "new-track")
                                    }
                                  />
                                }
                              />
                            </div>
                            <Show when={currentProject().song.tracks.length === 0}>
                              <NoTracks />
                            </Show>
                          </div>
                        </Match>
                        <Match when={props.view === "sequence"}>
                          <Show
                            when={opened()}
                            fallback={
                              <EmptyView
                                view="sequence"
                                title="No clip selected"
                                body="Select a clip in the arrangement, then press 2 to edit its steps or notes."
                                fixes={[viewFix("arrangement")]}
                                onFix={(view) => selectView(view, "empty_screen")}
                              />
                            }
                          >
                            {(open) => (
                              <SequenceEditor
                                clip={open().clip}
                                track={open().track}
                                project={currentProject()}
                                showPianoRoll={showPianoRoll}
                                loop={model.loopEntryFor(currentProject(), open().clip)}
                                songTempo={song.tempo()}
                                editorPlaybackStep={editorPlaybackStep}
                                selectedNoteIds={selectedNoteIds}
                                setSelectedNoteIds={setSelectedNoteIds}
                                playheadTicks={audio.positionTicks()}
                                registerPianoRollActions={setPianoRollActions}
                                playing={audio.isPlaying()}
                                onTogglePlay={() => void audio.toggle()}
                                audition={(pitch, velocity) =>
                                  void audio.auditionTrack(
                                    open().track.id,
                                    { kind: "pitch", pitch },
                                    AUDITION_DURATION_TICKS,
                                    velocity,
                                  )
                                }
                                selectedPadId={selectedPadOf(
                                  padSelection(),
                                  open().track,
                                )}
                                onSelectPad={(padId) => selectPad(open().track.id, padId)}
                                auditionPad={(padId) =>
                                  void audio.auditionPad(open().track.id, padId)
                                }
                                onAddPad={() => library.aim("slot", "new-pad")}
                                dispatch={session.dispatch}
                                beginGesture={session.beginGesture}
                              />
                            )}
                          </Show>
                        </Match>
                        <Match when={props.view === "instrument"}>
                          <SampleSlotTargetingContext value={slotTargeting}>
                            <EditorInstrument
                              project={currentProject()}
                              track={track() ?? null}
                              returnBus={selectedReturn()}
                              drumTrack={drumTrack() ?? null}
                              sampleAssets={sampleAssets()}
                              instrument={instrument()}
                              instrumentTrackId={instrumentPanelTrackId()}
                              sampleName={sampleName()}
                              loadSample={(sample) => void library.drop(sample)}
                              audition={auditionInstrument}
                              auditionPad={(trackId, padId) =>
                                void audio.auditionPad(trackId, padId)
                              }
                              onBrowse={() => library.aim("slot")}
                              onBrowsePad={(trackId, padId) => {
                                selectPad(trackId, padId);
                                library.aim("slot");
                              }}
                              onBrowseLoop={() => library.aim("slot")}
                              watchPeaks={audio.watchAssetPeaks}
                              watchTriggers={audio.watchTriggers}
                              trackLevel={audio.trackLevel}
                              onSelectTrack={selectTrackFrom}
                              chosenTrackId={deletableTrackId()}
                              selectedPadId={selectedPadOf(
                                padSelection(),
                                drumTrack() ?? null,
                              )}
                              onSelectPad={selectPad}
                              onAddTrack={(spec) =>
                                addTrack(currentProject(), spec, "instrument_add_track")
                              }
                              onAddLoop={() => library.aim("slot", "new-track")}
                              dispatch={session.dispatch}
                              beginGesture={session.beginGesture}
                            />
                          </SampleSlotTargetingContext>
                        </Match>
                        <Match when={props.view === "library"}>
                          {/* A fresh audition engine per visit: leaving disposes it
                        (LOOP-013), so a cached one would be dead. */}
                          <Show
                            when={library.target()}
                            fallback={
                              <LibraryEmpty
                                kind={
                                  library.aimed().kind as "synth" | "no-slot" | "no-track"
                                }
                                fix={viewFix}
                                onFix={(view) => selectView(view, "empty_screen")}
                              />
                            }
                          >
                            {(target) => (
                              <LibraryModal
                                client={libraryClient}
                                previewEngine={createAuditionEngine()}
                                slotAudition={library.slotAudition()}
                                analytics={props.analytics}
                                onInsert={(asset, options) =>
                                  library.insert(target(), asset, options)
                                }
                                addedPackIds={library.addedPackIds()}
                                assetTypes={targetAssetTypes(target())}
                                heading={
                                  SLOT_KINDS[target().kind] === "loop-track"
                                    ? "Loops"
                                    : "Library"
                                }
                                path={targetPath(currentProject(), target())}
                                slot={targetPath(currentProject(), target())
                                  .split(" › ")
                                  .at(-1)}
                                trackColor={track()?.color}
                                keyLabel={keyHint}
                                current={
                                  targetSound(currentProject(), target())?.name ?? null
                                }
                                slotKind={SLOT_KINDS[target().kind]}
                                songBpm={song.tempo()}
                                currentRef={
                                  targetSound(currentProject(), target())?.storageRef ??
                                  null
                                }
                                onActions={(actions) => library.registerActions(actions)}
                                onInsertAndReturn={() =>
                                  library.returnFromInsert("library_insert")
                                }
                                userLibrary={userLibrary}
                                isInUse={projectUses}
                              />
                            )}
                          </Show>
                        </Match>
                        <Match when={props.view === "mixer"}>
                          <div class="mixer-view">
                            <Mixer
                              project={currentProject()}
                              analytics={props.analytics}
                              dispatch={session.dispatch}
                              beginGesture={session.beginGesture}
                              trackLevel={audio.trackLevel}
                              selectedTrackId={track()?.id ?? null}
                              onSelectTrack={selectTrackFrom}
                              selectedReturnId={selectedReturn()?.id ?? null}
                              onSelectReturn={selectReturn}
                            />
                          </div>
                        </Match>
                      </Switch>
                    </div>
                  </DeviceSpectrumContext>
                  <ViewDock
                    view={props.view}
                    href={props.viewHref}
                    onSelect={(view) => selectView(view, "dock")}
                    keyHint={(view) => keyHint(editorViewSpec(view).actionId)}
                    opens={dockOpens}
                    dimmed={(view) => view === "sequence" && opened() === null}
                    marked={(view) => view === "library" && library.target() !== null}
                  />
                  {/*
                   * The assistant's slot (#849): its panel mounts here, once per
                   * editor, floating over the views or docked beside them. Docking
                   * moves `--assistant-dock-space` (EditorView.css), the editor's
                   * own layout, and no view learns the panel exists. A modal
                   * dialog (the same three that make `dialog` the only shortcut
                   * context) puts it under the dialog and out of reach.
                   */}
                  <AssistantPanel
                    panel={assistant}
                    underModal={() => guideOpen() || exportOpen()}
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
      </EditorControlsContext>
    </ControlRegistryContext>
  );
}
