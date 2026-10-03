import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import ArrangementView, {
  type PlacementEditingActions,
} from "../arrangement/ArrangementView";
import { getAudioRuntime } from "../audio/AudioRuntime";
import { clampTempo } from "../audio/Transport";
import { createControlGesture } from "../commands";
import { setParameter } from "../commands/definitions/parameters";
import { renameProject } from "../commands/definitions/project";
import type { NoteTrigger, Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { EventId, PadId, PlacementId, TrackId } from "../domain/ids";
import { SONG_SWING, SONG_TEMPO } from "../domain/parameters";
import { TICKS_PER_QUARTER } from "../domain/time";
import type { LibrarySample } from "../library/assetDrag";
import type { PreviewEngine } from "../library/audition";
import {
  insertLoopCommands,
  loadPadSampleCommands,
  loadSampleCommands,
  replaceLoopCommands,
  toLibrarySample,
} from "../library/insertion";
import type { LibraryClient } from "../library/libraryClient";
import type { SlotAudition } from "../library/slotAudition";
import { ToneAuditionEngine } from "../library/toneAuditionEngine";
import { getProjectRepository } from "../projectRepositoryClient";
import {
  emptySelection,
  reconcileSelection,
  type SelectionState,
  selectOnly,
} from "../selection";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
import EditorHeader from "./EditorHeader";
import EditorInstrument from "./EditorInstrument";
import EmptyView from "./EmptyView";
import * as model from "./editorViewModel";
import {
  type EditorViewName,
  editorViewSpec,
  type ViewChangeSource,
} from "./editorViews";
import LibraryEmpty from "./LibraryEmpty";
import LibraryModal, { type LibraryActions } from "./LibraryModal";
import {
  type LibraryTarget,
  libraryAim,
  targetAssetTypes,
  targetPath,
  targetSound,
} from "./libraryTarget";
import {
  type LoopActionContext,
  moveLoopByBars,
  resizeLoopByBars,
  toggleLooping,
} from "./loopActions";
import Mixer from "./Mixer";
import NewTrackButtons from "./NewTrackButtons";
import ProjectLoadStates from "./ProjectLoadStates";
import {
  emptyPadSelection,
  type PadSelection,
  selectedPadOf,
  withSelectedPad,
} from "./padSelection";
import type { PianoRollActions } from "./pianoRoll/rollActions";
import SequenceEditor from "./SequenceEditor";
import { deleteSelectedNotes } from "./StepEditor";
import { noteEventsOf, playbackStep as playbackStepOf } from "./stepEditorModel";
import {
  type AddTrackHost,
  addTrackOfKind,
  type NewTrackKindSpec,
} from "./trackCreation";
import { deleteTrack, type TrackDeletionContext } from "./trackDeletion";
import { useEditorSession } from "./useEditorSession";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { useProjectAudio } from "./useProjectAudio";
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
  // Where leaving the Library goes back to (`UI-002`): the view it came from.
  let libraryReturn: EditorViewName = "instrument";

  function selectView(next: EditorViewName, via: ViewChangeSource): void {
    // Asking for the view you are already on is not a switch, so it neither
    // navigates nor logs — otherwise clicking the current dock entry twice
    // would report two switches that never happened.
    if (next === props.view) return;
    if (next === "library") libraryReturn = props.view;
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
  // Whether the ruler's loop brace has keyboard focus, lifted so the registry's
  // `loop_brace` context can follow it (`LOOP-018`).
  const [loopBraceFocused, setLoopBraceFocused] = createSignal(false);
  // The step editor's note selection, lifted here so the `edit.delete` shortcut
  // can remove the same notes the grid shows highlighted (PRD KEY-01/CLP-02).
  const [selectedNoteIds, setSelectedNoteIds] = createSignal<readonly EventId[]>([]);
  // The arrangement's "add a loop" aims the Library at a new track (`UI-002`).
  // Every other aim is the selected track's own slot (`libraryTarget`), so
  // choosing a track or touching a slot ends this one.
  const [newTrackAim, setNewTrackAim] = createSignal(false);
  const leaveLibrary = () => selectView(libraryReturn, "keyboard");
  // Registered by the open library modal; the `library` shortcuts run them.
  const [libraryActions, setLibraryActions] = createSignal<LibraryActions | null>(null);
  // The Export dialog is a modal over the editor, so the editor's keys stand down.
  const [exportOpen, setExportOpen] = createSignal(false);

  // The project's packs: its derived dependencies and its shelf. Nothing in the
  // library window adds a pack for the session any more; inserting does.
  const addedPackIds = createMemo(() => model.addedPackIds(project(), []));

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
  const applyTempo = (value: number) => {
    if (!Number.isFinite(value)) return;
    session.dispatch(
      setParameter({ scope: "song", parameterId: SONG_TEMPO.id }, clampTempo(value)),
    );
  };

  // Swing is song state written through the same `parameter.set` as tempo
  // (#500). A drag is one gesture, so it is one undo step and one save; the
  // first commit counts as first use of the feature.
  const swing = createMemo(() => project()?.song.swing ?? SONG_SWING.defaultValue);
  const swingGesture = createControlGesture({
    beginGesture: (options) => session.beginGesture(options),
    dispatch: (commands) => session.dispatch(commands),
    summary: () => "Set swing",
    command: (value) =>
      setParameter({ scope: "song", parameterId: SONG_SWING.id }, value),
  });
  const commitSwing = (value: number) => {
    swingGesture.commit(value);
    (props.analytics ?? defaultAnalytics).logFeatureFirstUse("swing");
  };

  // The loop is song state too (LOOP-017): the header's toggle dispatches
  // `loop.setEnabled` and `useProjectAudio` mirrors `song.loop` onto the
  // transport, so this surface never touches the transport's loop itself.
  const loopActions: LoopActionContext = {
    project,
    dispatch: (commands) => session.dispatch(commands),
    get analytics() {
      return props.analytics ?? defaultAnalytics;
    },
  };

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
    setNewTrackAim(false);
    setSelection(selectOnly({ kind: "track", id: trackId }));
  }
  const selectedTrackId = createMemo(() => model.focusedTrackId(selection()));
  const trackDeletion: TrackDeletionContext = {
    project,
    dispatch: (commands) => session.dispatch(commands),
    select: selectTrack,
    get analytics() {
      return props.analytics ?? defaultAnalytics;
    },
  };

  // Which placement's clip the sequence view edits (`UI-001`, `UI-002`) — a
  // placement id, not a clip id: opening is a gesture on the timeline. It is
  // the selected clip only while its track is the selected track: choosing
  // another track leaves `2` with no clip, rather than on one the instrument
  // and mixer views have moved away from.
  const [openPlacementId, setOpenPlacementId] = createSignal<PlacementId | null>(null);
  const opened = createMemo(() => {
    const entry = model.openedClip(project(), openPlacementId());
    return entry && entry.track.id === selectedTrackId() ? entry : null;
  });

  /**
   * Makes a placement's clip the one `2` edits (`UI-002`): a click on a clip
   * in the arrangement selects it for the sequence view.
   */
  function selectPlacement(placementId: PlacementId): void {
    setOpenPlacementId(placementId);
    const track = model.openedClip(project(), placementId)?.track;
    // Selecting a clip is also saying "this track": the instrument view and the
    // mixer follow it, which is what keeps selection one piece of state.
    if (track) selectTrack(track.id);
  }

  /** Selects a placement's clip and goes to `2` with it (`UI-002`). */
  function openPlacement(placementId: PlacementId): void {
    selectPlacement(placementId);
    selectView("sequence", "arrangement");
  }

  const track = createMemo(() => model.editedTrack(project(), selectedTrackId()));
  const drumTrack = createMemo(() => model.drumTrack(track()));
  // Each drum track's selected pad (#643): one selection the instrument view's
  // pad editor and the step grid's selected row share, held here so it
  // outlives a switch of view.
  const [padSelection, setPadSelection] = createSignal<PadSelection>(emptyPadSelection);
  function selectPad(trackId: TrackId, padId: PadId): void {
    setNewTrackAim(false);
    setPadSelection((current) => withSelectedPad(current, trackId, padId));
  }

  // Where the Library is aimed (`UI-002`): the selected track's slot (its
  // selected pad, on a drum machine), or a new track, or why there is none.
  const libraryAimed = createMemo(() =>
    libraryAim(
      track() ?? null,
      selectedPadOf(padSelection(), drumTrack() ?? null),
      newTrackAim(),
    ),
  );
  const libraryTargetOf = createMemo(() => {
    const aim = libraryAimed();
    return aim.kind === "target" ? aim.target : null;
  });
  /** The Library view is on screen with somewhere to insert. */
  const libraryOpen = () => props.view === "library" && libraryTargetOf() !== null;

  /** Aims the Library and goes to `4` (`UI-002`). */
  function aimLibrary(via: ViewChangeSource, newTrack = false): void {
    setNewTrackAim(newTrack);
    selectView("library", via);
  }
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

  /** The step grid's Select all (#835): every note in the open clip. */
  function selectAllSteps(): (() => void) | undefined {
    const currentClip = clip();
    if (!currentClip) return undefined;
    return () => setSelectedNoteIds(noteEventsOf(currentClip).map((note) => note.id));
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
    selectAllSteps,
    guideOpen,
    setGuideOpen,
    exportOpen,
    libraryOpen,
    closeLibrary: leaveLibrary,
    libraryActions,
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
    toggleLooping: () => toggleLooping(loopActions),
    loopBraceFocused,
    moveLoop: (bars) => moveLoopByBars(loopActions, bars),
    resizeLoop: (bars) => resizeLoopByBars(loopActions, bars),
    // The mixer keeps the arrows: its strips are moved with them (#447).
    adjacentTrack: (by) => {
      if (props.view === "mixer") return undefined;
      const id = model.adjacentTrackId(project(), selectedTrackId(), by);
      return id ? () => selectTrack(id) : undefined;
    },
    // Backspace on the selected track (#537), where its header's trash button
    // is: not the mixer, and not in the sequence view. Only a track
    // the user chose — not the first-track fallback — so a stray key on a
    // freshly opened project deletes nothing.
    deleteSelectedTrack: () => {
      const id = selectedTrackId();
      if (props.view === "mixer" || props.view === "sequence" || id === null)
        return undefined;
      if (!project()?.song.tracks.some((candidate) => candidate.id === id))
        return undefined;
      return () => deleteTrack(trackDeletion, id);
    },
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

  /**
   * The slot the Library auditions through (LIB-010 hot-swap): its target's
   * pad or sampler. A loop or a new track fills no instrument, so loops
   * audition standalone, on the bar.
   */
  function slotAudition(): SlotAudition | undefined {
    const target = libraryTargetOf();
    const slot =
      target?.kind === "pad"
        ? { trackId: target.trackId, padId: target.padId }
        : target?.kind === "sampler"
          ? { trackId: target.trackId }
          : null;
    if (!slot) return undefined;
    return {
      preview: (asset) => audio.previewInSlot(slot, asset),
      clear: () => audio.clearPreview(),
      isPlaying: () => audio.isPlaying(),
    };
  }

  /**
   * Inserts into the Library's target (`UI-002`): one transaction, so one
   * revision and one undo. A loop inserted on a new track selects that track,
   * so the next loop tried replaces it rather than adding another.
   */
  function insertIntoTarget(sample: LibrarySample, target: LibraryTarget): boolean {
    if (target.kind === "pad") return loadPadSample(sample, target);
    if (target.kind === "loop") return replaceLoop(sample, target.trackId);
    if ((sample.kind === "loop") !== (target.kind === "new-track")) return false;
    if (!loadLibrarySample(sample)) return false;
    const added = project()?.song.tracks.at(-1);
    if (target.kind === "new-track" && added) selectTrack(added.id);
    return true;
  }

  /**
   * Puts a library sound into the project — the one path the drag onto the
   * instrument panel and the browser's "Insert" button both take, so the
   * pointer gesture and its keyboard equivalent produce the same transaction
   * (PRD 9.3) and log the same event once (#225).
   *
   * **The asset's kind chooses what inserting means.** A one-shot loads onto
   * the sampler of the track the editor is pointed at; a loop has no
   * instrument to load onto, so it arrives as its own audio track carrying an
   * `audioLoop` clip at bar 1 (`LOOP-019`). Either way it is one transaction,
   * so it is one revision and one undo.
   *
   * Both paths can decline, and a decline has to be visible: the Loop button
   * used to reach a sampler-only path that returned silently, so inserting a
   * loop closed the window and did nothing at all. `onInsert` now only closes
   * on a committed transaction, and a refusal says why.
   */
  function loadLibrarySample(sample: LibrarySample): boolean {
    const currentProject = project();
    if (!currentProject) return false;
    const analytics = props.analytics ?? defaultAnalytics;

    if (sample.kind === "loop") {
      const result = session.dispatch(
        insertLoopCommands(currentProject, sample, createFactoryContext(), {
          order: currentProject.song.tracks.length,
          existingNames: currentProject.song.tracks.map((entry) => entry.name),
          songTempo: currentProject.song.tempo,
        }),
      );
      if (!result?.ok) return false;
      // No `instrument_type`: an audio track carries no instrument, which is
      // the case the catalog leaves that param optional for.
      analytics.log("track_added", { track_type: "audio" });
      analytics.logFeatureFirstUse("audio_loop");
      return true;
    }

    // The track the editor is pointed at (#228), not the project's first —
    // so a drop lands on whichever track the user selected.
    const trackId = model.samplerTrackId(track());
    if (!trackId) return false;
    const result = session.dispatch(
      loadSampleCommands(currentProject, trackId, sample, createFactoryContext()),
    );
    if (!result?.ok) return false;
    analytics.log("instrument_changed", { instrument_type: "sampler" });
    analytics.logFeatureFirstUse("sampler");
    return true;
  }

  /**
   * Changes the loop a loop track plays, from the loop slot that opened the
   * library: one transaction, so one revision and one undo. It is the same
   * use of an audio loop the Loop button's insertion is, so it logs the same
   * first use.
   */
  function replaceLoop(sample: LibrarySample, trackId: TrackId): boolean {
    const currentProject = project();
    if (!currentProject || sample.kind !== "loop") return false;
    const commands = replaceLoopCommands(
      currentProject,
      trackId,
      sample,
      createFactoryContext(),
      { songTempo: currentProject.song.tempo },
    );
    if (commands.length === 0) return false;
    const result = session.dispatch(commands);
    if (!result?.ok) return false;
    (props.analytics ?? defaultAnalytics).logFeatureFirstUse("audio_loop");
    return true;
  }

  /**
   * Loads a library one-shot onto the drum pad whose slot opened the library
   * (#447), as one transaction: the asset if the project lacks it, then the
   * pad. Only the library's Insert reaches this; a drop still lands on the
   * sampler, whatever the library was last opened for.
   */
  function loadPadSample(
    sample: LibrarySample,
    pad: { trackId: TrackId; padId: PadId },
  ): boolean {
    const currentProject = project();
    if (!currentProject || sample.kind === "loop") return false;
    const result = session.dispatch(
      loadPadSampleCommands(
        currentProject,
        pad.trackId,
        pad.padId,
        sample,
        createFactoryContext(),
      ),
    );
    if (!result?.ok) return false;
    const analytics = props.analytics ?? defaultAnalytics;
    // A pad sample replacement is an instrument change (PRD OPS-02).
    analytics.log("instrument_changed", { instrument_type: "drum_machine" });
    analytics.logFeatureFirstUse("drum_machine");
    return true;
  }

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
    <main class={["editor", `editor-${props.view}`]}>
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
                onRename={(name) => session.dispatch(renameProject(name))}
                session={session}
                audio={audio}
                onToggleLoop={() => toggleLooping(loopActions)}
                tempo={tempo}
                onTempoChange={applyTempo}
                swing={swing}
                onSwingInput={swingGesture.input}
                onSwingCommit={commitSwing}
                onOpenGuide={() => setGuideOpen(true)}
                onExportOpenChange={setExportOpen}
                keyHint={keyHint}
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
                          onSelectTrack={selectTrack}
                          onOpenPlacement={openPlacement}
                          onSelectPlacement={selectPlacement}
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
                              onAddLoop={() => aimLibrary("arrangement", true)}
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
                          songTempo={tempo()}
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
                          selectedPadId={selectedPadOf(padSelection(), open().track)}
                          onSelectPad={(padId) => selectPad(open().track.id, padId)}
                          auditionPad={(padId) =>
                            void audio.auditionPad(open().track.id, padId)
                          }
                          dispatch={session.dispatch}
                          beginGesture={session.beginGesture}
                        />
                      )}
                    </Show>
                  </Match>
                  <Match when={props.view === "instrument"}>
                    <EditorInstrument
                      project={currentProject()}
                      track={track() ?? null}
                      drumTrack={drumTrack() ?? null}
                      sampleAssets={sampleAssets()}
                      instrument={instrument()}
                      instrumentTrackId={instrumentPanelTrackId()}
                      sampleName={sampleName()}
                      loadSample={loadLibrarySample}
                      audition={auditionInstrument}
                      auditionPad={(trackId, padId) =>
                        void audio.auditionPad(trackId, padId)
                      }
                      onBrowse={() => aimLibrary("slot")}
                      onBrowsePad={(trackId, padId) => {
                        selectPad(trackId, padId);
                        aimLibrary("slot");
                      }}
                      onBrowseLoop={() => aimLibrary("slot")}
                      watchPeaks={audio.watchAssetPeaks}
                      watchTriggers={audio.watchTriggers}
                      trackLevel={audio.trackLevel}
                      onSelectTrack={selectTrack}
                      selectedPadId={selectedPadOf(padSelection(), drumTrack() ?? null)}
                      onSelectPad={selectPad}
                      onAddTrack={(spec) =>
                        addTrack(currentProject(), spec, "instrument_add_track")
                      }
                      onAddLoop={() => aimLibrary("slot", true)}
                      dispatch={session.dispatch}
                      beginGesture={session.beginGesture}
                    />
                  </Match>
                  <Match when={props.view === "library"}>
                    {/* A fresh audition engine per visit: leaving disposes it
                        (LOOP-013), so a cached one would be dead. */}
                    <Show
                      when={libraryTargetOf()}
                      fallback={
                        <LibraryEmpty
                          kind={libraryAimed().kind as "synth" | "no-slot" | "no-track"}
                          fix={viewFix}
                          onFix={(view) => selectView(view, "empty_screen")}
                        />
                      }
                    >
                      {(target) => (
                        <LibraryModal
                          client={props.libraryClient}
                          previewEngine={createAuditionEngine()}
                          slotAudition={slotAudition()}
                          analytics={props.analytics}
                          onInsert={(asset) => {
                            const sample = toLibrarySample(asset);
                            // Only a committed insertion leaves (a refusal stays).
                            if (sample && insertIntoTarget(sample, target()))
                              leaveLibrary();
                          }}
                          addedPackIds={addedPackIds()}
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
                          current={targetSound(currentProject(), target())?.name ?? null}
                          slotKind={SLOT_KINDS[target().kind]}
                          songBpm={tempo()}
                          currentRef={
                            targetSound(currentProject(), target())?.storageRef ?? null
                          }
                          onActions={(actions) => setLibraryActions(() => actions)}
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
                        onSelectTrack={selectTrack}
                      />
                    </div>
                  </Match>
                </Switch>
              </div>
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
