// The project route's top-level editor component.

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
import { provideStoredAudio } from "../audio/storedAudio";
import { type CapabilityReport, FULLY_CAPABLE } from "../browser/capabilities";
import { reportMissingCapabilities } from "../browser/reportCapabilities";
import { renameProject } from "../commands/definitions/project";
import { ControlRegistryContext } from "../controls/control";
import { createControlRegistry } from "../controls/registry";
import type { Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { PlacementId } from "../domain/ids";
import type { PreviewEngine } from "../library/audition";
import { type LibraryClient, sharedLibraryClient } from "../library/libraryClient";
import { getProjectRepository } from "../projectRepositoryClient";
import type { ArrangementSelection } from "../selection";
import ShortcutGuide from "../shortcuts/ShortcutGuide";
import { getUserLibraryRepository } from "../userLibrary/userLibraryClient";
import type { UserLibraryRepository } from "../userLibrary/userLibraryRepository";
import { userPackAvailability } from "../userLibrary/userPacks";
import { type UserLibraryAccount, useUserLibrary } from "../userLibrary/useUserLibrary";
import ArrangementPane from "./ArrangementPane";
import AssistantPanel from "./assistant/AssistantPanel";
import { useAssistantPanel } from "./assistant/useAssistantPanel";
import CompatibilityNotice from "./CompatibilityNotice";
import { compatibilityNoticeItems } from "./compatibilityNoticeItems";
import { DeviceSpectrumContext, type DeviceSpectrumSource } from "./deviceSpectrum";
import EditorHeader from "./EditorHeader";
import { type EditorControls, EditorControlsContext } from "./editorControls";
import { type EditorViewName, editorViewSpec } from "./editorViews";
import InstrumentPane from "./InstrumentPane";
import LibraryPane from "./LibraryPane";
import LoadRecoveryNotice from "./LoadRecoveryNotice";
import MissingSounds from "./MissingSounds";
import Mixer from "./Mixer";
import ProjectLoadStates from "./ProjectLoadStates";
import SequencePane from "./SequencePane";
import {
  type AddTrackHost,
  addTrackOfKind,
  type NewTrackKindSpec,
} from "./trackCreation";
import { useEditingSurfaces } from "./useEditingSurfaces";
import { useEditorNavigation } from "./useEditorNavigation";
import { useEditorReveal } from "./useEditorReveal";
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
    selectTrackFrom,
    opened,
    selectPlacement,
    track,
    selectedReturn,
    selectReturn,
  } = trackSelection;

  // What the editing surfaces hand up so the shortcut layer can act on them.
  const surfaces = useEditingSurfaces({ opened, audio, session });

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

  // Finding and showing a control by its address (`UI-004`): UI state only.
  const editorControls = useEditorReveal({
    registry: controls,
    project,
    view: () => props.view,
    navigation,
    selection: trackSelection,
  });
  props.onControlsReady?.(editorControls);
  // The assistant's panel (#849): where it is and how big, remembered on this
  // device. One per editor, shared by the panel, the header's button and the
  // shortcut layer.
  const assistant = useAssistantPanel({ analytics: () => props.analytics });
  // Docked, the editor's views leave the panel's column free (EditorView.css).
  const assistantDockSpace = () =>
    assistant.layout().mode === "docked" ? `${assistant.layout().width}px` : "0px";

  const { shortcuts, editorContexts, keyHint } = useEditorShortcuts({
    view: () => props.view,
    project,
    audio,
    session,
    analytics,
    navigation,
    selection: trackSelection,
    library,
    song,
    surfaces,
    openPlacement,
    guideOpen,
    setGuideOpen,
    exportOpen,
    assistant,
  });

  /** An empty screen's way out: a view, named and keyed as the dock names it. */
  const viewFix = (view: EditorViewName) => ({
    view,
    label: editorViewSpec(view).label,
    keyLabel: keyHint(editorViewSpec(view).actionId),
  });

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
                          <ArrangementPane
                            project={currentProject()}
                            audio={audio}
                            session={session}
                            selection={trackSelection}
                            surfaces={surfaces}
                            onOpenPlacement={openPlacement}
                            initialSelection={arrangementSelection}
                            onSelectionChange={(selected) => {
                              arrangementSelection = selected;
                            }}
                            onAddTrack={(spec) => addTrack(currentProject(), spec)}
                            onAddLoop={() => library.aim("arrangement", "new-track")}
                          />
                        </Match>
                        <Match when={props.view === "sequence"}>
                          <SequencePane
                            project={currentProject()}
                            audio={audio}
                            session={session}
                            selection={trackSelection}
                            surfaces={surfaces}
                            songTempo={song.tempo()}
                            onAddPad={() => library.aim("slot", "new-pad")}
                            fix={viewFix}
                            onFix={(view) => selectView(view, "empty_screen")}
                          />
                        </Match>
                        <Match when={props.view === "instrument"}>
                          <InstrumentPane
                            project={currentProject()}
                            audio={audio}
                            session={session}
                            selection={trackSelection}
                            library={library}
                            keyHint={keyHint}
                            onAddTrack={(spec) =>
                              addTrack(currentProject(), spec, "instrument_add_track")
                            }
                          />
                        </Match>
                        <Match when={props.view === "library"}>
                          <LibraryPane
                            project={currentProject()}
                            library={library}
                            selection={trackSelection}
                            client={libraryClient}
                            createAuditionEngine={props.createAuditionEngine}
                            analytics={props.analytics}
                            keyHint={keyHint}
                            songBpm={song.tempo()}
                            fix={viewFix}
                            onFix={(view) => selectView(view, "empty_screen")}
                            userLibrary={userLibrary}
                          />
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
