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
import ArrangementView, {
  type PlacementEditingActions,
} from "../arrangement/ArrangementView";
import { getAudioRuntime } from "../audio/AudioRuntime";
import { clampTempo } from "../audio/Transport";
import { type CapabilityReport, FULLY_CAPABLE } from "../browser/capabilities";
import { reportMissingCapabilities } from "../browser/reportCapabilities";
import { createControlGesture } from "../commands";
import { setParameter } from "../commands/definitions/parameters";
import { renameProject } from "../commands/definitions/project";
import { ControlRegistryContext } from "../controls/control";
import { createControlRegistry } from "../controls/registry";
import type { NoteTrigger, Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { EventId, PadId, PlacementId, ReturnId, TrackId } from "../domain/ids";
import { SONG_SWING, SONG_TEMPO } from "../domain/parameters";
import { TICKS_PER_QUARTER } from "../domain/time";
import {
  type SampleSlotTargeting,
  SampleSlotTargetingContext,
} from "../instrument/sampleSlotTargeting";
import type { LibrarySample } from "../library/assetDrag";
import type { PreviewEngine } from "../library/audition";
import {
  addPadWithSampleCommands,
  insertLoopCommands,
  loadPadSampleCommands,
  loadSampleCommands,
  replaceLoopCommands,
} from "../library/insertion";
import { type LibraryClient, sharedLibraryClient } from "../library/libraryClient";
import type { LibraryAsset } from "../library/manifest";
import type { SlotAudition } from "../library/slotAudition";
import { ToneAuditionEngine } from "../library/toneAuditionEngine";
import { getProjectRepository } from "../projectRepositoryClient";
import {
  type ArrangementSelection,
  emptySelection,
  reconcileSelection,
  type SelectionState,
  selectOnly,
} from "../selection";
import { timeoutScheduler } from "../shared/scheduler";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
import type { UserLibraryRepository } from "../userLibrary/userLibraryRepository";
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
import {
  type EditorViewName,
  editorViewSpec,
  type ViewChangeSource,
} from "./editorViews";
import LibraryEmpty from "./LibraryEmpty";
import LibraryModal, { type LibraryActions } from "./LibraryModal";
import LoadRecoveryNotice from "./LoadRecoveryNotice";
import {
  dropFromLibrary,
  insertFromLibrary,
  type LibraryInsertHost,
} from "./libraryInsert";
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
import type { TrackSelectionSource } from "./trackSurface";
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

/**
 * The targets a committed insert goes back from to where the Library was
 * reached, rather than to the instrument: the new track goes back to the
 * arrangement, the new pad to the Sequence view's [+ Pad] row (#947).
 */
const AIMS_BACK: ReadonlySet<LibraryTarget["kind"] | undefined> = new Set([
  "new-track",
  "new-pad",
]);

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
  // The Sequence view's [+ Pad] row aims it at a pad the drum machine does not
  // have yet (#947); inserting adds it, which selects it and ends this aim.
  const [newPadAim, setNewPadAim] = createSignal(false);
  /**
   * Where a committed insert goes back to (`UI-002`): the instrument, where the
   * slot just filled shows its new sound. A loop inserted on a new track goes
   * back to where it was asked for instead, the arrangement it now sits in,
   * and so does a new pad, to the Sequence view whose [+ Pad] row asked (#947).
   * That reads the target the insert was aimed at: the insert itself selects
   * the new track, which re-aims the Library before going back runs.
   */
  let insertedInto: LibraryTarget | null = null;
  const returnFromInsert = (via: ViewChangeSource) =>
    selectView(
      AIMS_BACK.has((insertedInto ?? libraryTargetOf())?.kind)
        ? libraryReturn
        : "instrument",
      via,
    );
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
  // The one shared library client, so the Library view and the
  // pack-upgrade check (#892) share its cached index and manifests.
  const libraryClient = props.libraryClient ?? sharedLibraryClient();
  // The producer's own packs (#282). Held by the editor, not the library
  // view, so an import keeps going after you leave the Library view.
  const userLibrary = useUserLibrary({
    account: () => props.libraryAccount ?? null,
    analytics: props.analytics,
    repository: props.userLibraryRepository,
  });
  /** Whether the open project uses a sound: its stored audio is one of the song's. */
  const projectUses = (asset: LibraryAsset): boolean =>
    asset.storageRef !== undefined &&
    (project()?.song.assets.some((used) => used.storageRef === asset.storageRef) ??
      false);

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
  // Whether the user *chose* the selected track (#960): through its header,
  // the track list, the instrument rail, or the track arrows. Only a chosen
  // track is Delete's to remove. Every other way a track ends up selected — a
  // lane or clip click, opening a clip, a deleted neighbour, a new track —
  // only points the editor at it, and clears the choice.
  const [chosenTrackId, setChosenTrackId] = createSignal<TrackId | null>(null);
  // The return the mixer pointed the editor at (#386), which puts the
  // instrument view in return mode. UI-only like the track selection, and
  // beside it rather than in it: the arrangement and the step editor keep
  // following the track while a return's chain is open. Selecting any track
  // clears it, and so does the return being deleted or undone away: the view
  // falls back to the track, and stays there when an undo brings the return
  // back.
  const [returnSelection, setReturnSelection] = createSignal<ReturnId | null>(null);
  const selectedReturn = createMemo(() => {
    const id = returnSelection();
    return id ? (project()?.song.returns.find((bus) => bus.id === id) ?? null) : null;
  });
  // Both reads in compute; the write is only legal in the apply half.
  createEffect(
    () => returnSelection() !== null && selectedReturn() === null,
    (stale) => {
      if (stale) setReturnSelection(null);
    },
  );
  function selectTrack(trackId: TrackId, chosen = false): void {
    setNewTrackAim(false);
    setReturnSelection(null);
    setNewPadAim(false);
    setSelection(selectOnly({ kind: "track", id: trackId }));
    setChosenTrackId(chosen ? trackId : null);
  }
  const chooseTrack = (trackId: TrackId) => selectTrack(trackId, true);
  const selectTrackFrom = (trackId: TrackId, how: TrackSelectionSource) =>
    selectTrack(trackId, how === "header");
  const selectedTrackId = createMemo(() => model.focusedTrackId(selection()));
  /** The selected track, if the user chose it; else null. */
  const deletableTrackId = createMemo(() => {
    const id = chosenTrackId();
    return id !== null && id === selectedTrackId() ? id : null;
  });
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
  // The arrangement's own selection, kept while another view is on screen:
  // the arrangement is rebuilt on the way back and starts from it, so the
  // clip you selected is still highlighted (`UI-002`). Read only on mount, so
  // a plain variable rather than a signal.
  let arrangementSelection: ArrangementSelection | null = null;
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
    setNewPadAim(false);
    setPadSelection((current) => withSelectedPad(current, trackId, padId));
  }

  // Where the Library is aimed (`UI-002`): the selected track's slot (its
  // selected pad, on a drum machine), or a new track, or why there is none.
  const libraryAimed = createMemo(() =>
    libraryAim(
      track() ?? null,
      selectedPadOf(padSelection(), drumTrack() ?? null),
      newTrackAim(),
      newPadAim(),
    ),
  );
  const libraryTargetOf = createMemo(() => {
    const aim = libraryAimed();
    return aim.kind === "target" ? aim.target : null;
  });
  /** The Library view is on screen with somewhere to insert. */
  const libraryOpen = () => props.view === "library" && libraryTargetOf() !== null;

  /** What a dock tile's tip says its view will open (`UI-002`). */
  function dockOpens(view: EditorViewName): string | undefined {
    if (view === "sequence") return opened()?.clip.name;
    if (view === "instrument") return track()?.name;
    if (view !== "library") return undefined;
    const target = libraryTargetOf();
    if (target?.kind === "new-track") return "loops for a new track";
    return target ? `sounds for ${track()?.name ?? "the track"}` : undefined;
  }

  /** What every sample slot shows of the Library's aim (`UI-002`). */
  const slotTargeting: SampleSlotTargeting = {
    get keyLabel() {
      return keyHint("view.show_library");
    },
    isTarget: (slot) => {
      const target = libraryTargetOf();
      if (target?.kind !== slot.kind) return false;
      return (
        target.kind !== "pad" || (slot.kind === "pad" && slot.padId === target.padId)
      );
    },
  };

  /**
   * Aims the Library and goes to `4` (`UI-002`): at the selected track's slot,
   * or at a new track or a new pad when one was asked for.
   */
  function aimLibrary(via: ViewChangeSource, aim?: "new-track" | "new-pad"): void {
    setNewTrackAim(aim === "new-track");
    setNewPadAim(aim === "new-pad");
    selectView("library", via);
  }
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
      selection: selection(),
      padSelection: padSelection(),
      openPlacementId: openPlacementId(),
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
      const current = project();
      setSelection(
        current ? reconcileSelection(location.selection, current) : location.selection,
      );
      setPadSelection(location.padSelection);
      setOpenPlacementId(location.openPlacementId);
    },
    scheduler: timeoutScheduler,
  });
  onCleanup(() => editorControls.dispose());
  props.onControlsReady?.(editorControls);
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
    libraryOpen,
    returnFromInsert: () => returnFromInsert("keyboard"),
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
      deletableTrackId() === null ? undefined : () => setChosenTrackId(null),
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
  function insertIntoTarget(sample: LibrarySample, target: LibraryTarget): string | null {
    if (target.kind === "pad") return loadPadSample(sample, target);
    if (target.kind === "new-pad") return addPadWithSample(sample, target.trackId);
    if (target.kind === "loop") return replaceLoop(sample, target.trackId);
    if (target.kind === "new-track" && sample.kind !== "loop") {
      return `Couldn't insert ${sample.name}: only a loop can start a new loop track.`;
    }
    if (target.kind === "sampler" && sample.kind === "loop") {
      return `Couldn't insert ${sample.name}: a loop can't go on a sampler.`;
    }
    // A loop's insert selects the track it created (#879). Reading
    // `project()` here for "the last track" would see the project from before
    // the insert, not yet flushed, and select the wrong track.
    return loadLibrarySample(sample);
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
   * `audioLoop` clip at bar 1 (`LOOP-019`), and that new track is selected.
   * Either way it is one transaction, so it is one revision and one undo.
   *
   * Both paths can decline, and a decline has to be visible: the Loop button
   * used to reach a sampler-only path that returned silently, so inserting a
   * loop closed the window and did nothing at all. Each of these returns
   * `null` when it landed, else the sentence the library's footer shows
   * (#892), and only a committed insert goes back on Enter.
   */
  function loadLibrarySample(sample: LibrarySample): string | null {
    const currentProject = project();
    if (!currentProject) return notOpen(sample);
    const analytics = props.analytics ?? defaultAnalytics;

    if (sample.kind === "loop") {
      const insert = insertLoopCommands(currentProject, sample, createFactoryContext(), {
        order: currentProject.song.tracks.length,
        existingNames: currentProject.song.tracks.map((entry) => entry.name),
        songTempo: currentProject.song.tempo,
      });
      const result = session.dispatch(insert.commands);
      if (!result?.ok) return refusedBy(sample);
      // A track you just added is the one you want to see, as with every other
      // added track (#879). Selection is UI state, so the insert stays one
      // transaction; the view does not change.
      selectTrack(insert.trackId);
      // No `instrument_type`: an audio track carries no instrument, which is
      // the case the catalog leaves that param optional for.
      analytics.log("track_added", { track_type: "audio" });
      analytics.logFeatureFirstUse("audio_loop");
      return null;
    }

    // The track the editor is pointed at (#228), not the project's first —
    // so a drop lands on whichever track the user selected.
    const trackId = model.samplerTrackId(track());
    if (!trackId) {
      return `Couldn't insert ${sample.name}: the selected track has no sampler to load it on.`;
    }
    const result = session.dispatch(
      loadSampleCommands(currentProject, trackId, sample, createFactoryContext()),
    );
    if (!result?.ok) return refusedBy(sample);
    analytics.log("instrument_changed", { instrument_type: "sampler" });
    analytics.logFeatureFirstUse("sampler");
    return null;
  }

  /**
   * Changes the loop a loop track plays, from the loop slot that opened the
   * library: one transaction, so one revision and one undo. It is the same
   * use of an audio loop the Loop button's insertion is, so it logs the same
   * first use.
   */
  function replaceLoop(sample: LibrarySample, trackId: TrackId): string | null {
    const currentProject = project();
    if (!currentProject) return notOpen(sample);
    if (sample.kind !== "loop") {
      return `Couldn't insert ${sample.name}: only a loop can replace a loop track's loop.`;
    }
    const commands = replaceLoopCommands(
      currentProject,
      trackId,
      sample,
      createFactoryContext(),
      { songTempo: currentProject.song.tempo },
    );
    if (commands.length === 0) {
      return `Couldn't insert ${sample.name}: this track doesn't play a loop.`;
    }
    const result = session.dispatch(commands);
    if (!result?.ok) return refusedBy(sample);
    (props.analytics ?? defaultAnalytics).logFeatureFirstUse("audio_loop");
    return null;
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
  ): string | null {
    const currentProject = project();
    if (!currentProject) return notOpen(sample);
    if (sample.kind === "loop") {
      return `Couldn't insert ${sample.name}: a loop can't go on a drum pad.`;
    }
    const result = session.dispatch(
      loadPadSampleCommands(
        currentProject,
        pad.trackId,
        pad.padId,
        sample,
        createFactoryContext(),
      ),
    );
    if (!result?.ok) return refusedBy(sample);
    const analytics = props.analytics ?? defaultAnalytics;
    // A pad sample replacement is an instrument change (PRD OPS-02).
    analytics.log("instrument_changed", { instrument_type: "drum_machine" });
    analytics.logFeatureFirstUse("drum_machine");
    return null;
  }

  /**
   * Adds a pad playing a library one-shot to the drum track whose Sequence
   * view [+ Pad] row opened the library (#947): one transaction, so one undo
   * takes the pad away. The new pad's lane is selected, which the step grid
   * and the instrument view's pad editor share.
   */
  function addPadWithSample(sample: LibrarySample, trackId: TrackId): string | null {
    const currentProject = project();
    if (!currentProject) return notOpen(sample);
    if (sample.kind === "loop") {
      return `Couldn't insert ${sample.name}: a loop can't go on a drum pad.`;
    }
    const insert = addPadWithSampleCommands(
      currentProject,
      trackId,
      sample,
      createFactoryContext(),
    );
    const result = session.dispatch(insert.commands);
    if (!result?.ok) return refusedBy(sample);
    selectPad(trackId, insert.padId);
    const analytics = props.analytics ?? defaultAnalytics;
    // What a pad given a sound logs on the instrument view (PRD OPS-02).
    analytics.log("instrument_changed", { instrument_type: "drum_machine" });
    analytics.logFeatureFirstUse("drum_machine");
    analytics.logFeatureFirstUse("sequence_add_pad");
    return null;
  }

  /**
   * The Library's insert into `target`, through the pack-upgrade check (#892).
   */
  function targetHost(target: LibraryTarget): LibraryInsertHost {
    return libraryHost((sample) => insertIntoTarget(sample, target));
  }

  /** A drop on the instrument panel always loads the selected sampler. */
  const dropHost = libraryHost(loadLibrarySample);

  function libraryHost(insert: LibraryInsertHost["insert"]): LibraryInsertHost {
    return {
      project,
      client: libraryClient,
      get analytics() {
        return props.analytics ?? defaultAnalytics;
      },
      insert,
    };
  }

  /** The footer's sentence when there is no project to insert into. */
  function notOpen(sample: LibrarySample): string {
    return `Couldn't insert ${sample.name}: the project isn't open.`;
  }

  /** The footer's sentence when the project's own checks refused the change. */
  function refusedBy(sample: LibrarySample): string {
    return `Couldn't insert ${sample.name}: the project can't take it, so nothing changed.`;
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
                    onToggleLoop={() => toggleLooping(loopActions)}
                    tempo={tempo}
                    onTempoChange={applyTempo}
                    swing={swing}
                    onSwingInput={swingGesture.input}
                    onSwingCommit={commitSwing}
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
                                      aimLibrary("arrangement", "new-track")
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
                                selectedPadId={selectedPadOf(
                                  padSelection(),
                                  open().track,
                                )}
                                onSelectPad={(padId) => selectPad(open().track.id, padId)}
                                auditionPad={(padId) =>
                                  void audio.auditionPad(open().track.id, padId)
                                }
                                onAddPad={() => aimLibrary("slot", "new-pad")}
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
                              loadSample={(sample) =>
                                void dropFromLibrary(dropHost, sample)
                              }
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
                              onAddLoop={() => aimLibrary("slot", "new-track")}
                              dispatch={session.dispatch}
                              beginGesture={session.beginGesture}
                            />
                          </SampleSlotTargetingContext>
                        </Match>
                        <Match when={props.view === "library"}>
                          {/* A fresh audition engine per visit: leaving disposes it
                        (LOOP-013), so a cached one would be dead. */}
                          <Show
                            when={libraryTargetOf()}
                            fallback={
                              <LibraryEmpty
                                kind={
                                  libraryAimed().kind as "synth" | "no-slot" | "no-track"
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
                                slotAudition={slotAudition()}
                                analytics={props.analytics}
                                onInsert={(asset, options) => {
                                  insertedInto = target();
                                  return insertFromLibrary(
                                    targetHost(insertedInto),
                                    asset,
                                    options,
                                  );
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
                                current={
                                  targetSound(currentProject(), target())?.name ?? null
                                }
                                slotKind={SLOT_KINDS[target().kind]}
                                songBpm={tempo()}
                                currentRef={
                                  targetSound(currentProject(), target())?.storageRef ??
                                  null
                                }
                                onActions={(actions) => setLibraryActions(() => actions)}
                                onInsertAndReturn={() =>
                                  returnFromInsert("library_insert")
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
                              onSelectReturn={setReturnSelection}
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
                    marked={(view) => view === "library" && libraryTargetOf() !== null}
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
