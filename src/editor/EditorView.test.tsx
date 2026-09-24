import { createRouter, memoryHistory, useLocation, useNavigate } from "@solidjs/router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { ROW_METRICS } from "../arrangement/ArrangementView";
import { installWebAudioGlobals } from "../audio/testAudioContext";
import {
  createDrumMachineFixtureProject,
  createPianoRollFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { fakePreviewEngine } from "../library/__fixtures__/fakePreviewEngine";
import { fixtureFetcher, fixturePackManifest } from "../library/__fixtures__/fixtures";
import { LIBRARY_SAMPLE_MIME } from "../library/assetDrag";
import type { PreviewEngine } from "../library/audition";
import { LibraryClient } from "../library/libraryClient";
import { packAssets, parsePackManifest } from "../library/manifest";
import type { InMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { detectPlatform, shortcutLabel } from "../shortcuts";
import { clickAndFlush, fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import { editorViewFromPath, editorViewPath } from "./editorViews";
import { NEW_TRACK_KINDS } from "./trackCreation";

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("../audio/AudioRuntime");
let inMemoryModule: typeof import("../persistence/inMemoryProjectRepository");
let documentsModule: typeof import("../persistence/documents");
let EditorViewModule: typeof import("./EditorView");

beforeAll(async () => {
  AudioRuntimeModule = await import("../audio/AudioRuntime");
  inMemoryModule = await import("../persistence/inMemoryProjectRepository");
  documentsModule = await import("../persistence/documents");
  EditorViewModule = await import("./EditorView");
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  try {
    await AudioRuntimeModule.getAudioRuntime().close();
  } catch {
    // already closed
  }
  AudioRuntimeModule.__resetAudioRuntimeForTests();
});

let repository: InMemoryProjectRepository;

vi.mock("../projectRepositoryClient", () => ({
  getProjectRepository: () => Promise.resolve(repository),
}));

/**
 * Paints or erases one step-editor cell the way a pointer does: `pointerdown`
 * begins the stroke (add if the cell is empty, erase if filled), `pointerup`
 * commits it as one history entry. `fireEvent.click` is not enough — the step
 * editor drives painting from pointer events, not click, so a drag never starts
 * a text selection (CLP-02).
 */
function paintStep(name: string): void {
  const cell = screen.getByRole("button", { name });
  fireEvent.pointerDown(cell, { button: 0 });
  fireEvent.pointerUp(cell);
}

/**
 * The header's save-status group. Save-failure assertions are scoped to it
 * rather than queried across the document: the library panel is open from the
 * first paint (#221) and reports its own failed load — with the same "Check
 * your connection." wording and its own Retry button — whenever its manifest
 * fetch fails, which it always does under jsdom.
 */
function saveStatusGroup(): HTMLElement {
  const group = document.querySelector<HTMLElement>(".save-status-group");
  if (!group) throw new Error("expected the header's save-status group");
  return group;
}

/**
 * The mixer's "edit this track" control for one strip. Scoped to the mixer:
 * the arrangement's header column offers the identically named control for the
 * same track, which is the point — either surface selects it.
 */
function mixerSelect(trackName: string): HTMLElement {
  return within(screen.getByRole("region", { name: "Mixer" })).getByRole("button", {
    name: `Edit ${trackName}`,
  });
}

/**
 * Opens the clip at bar 1 of the first arrangement row the way a producer does
 * — a double-click on the timeline (`UI-001`) — and waits for the sequence
 * editor it brings up. The coordinates mirror the renderer's own constants,
 * because a canvas has no DOM node to query for a hit.
 */
async function openSequenceEditor(rowIndex = 0): Promise<HTMLElement> {
  await screen.findByTestId("arrangement-view-ready");
  const canvas = document.querySelector(".arrangement-layer-interactive");
  if (!canvas) throw new Error("no arrangement interaction canvas rendered");
  const PIXELS_PER_TICK = 0.08;
  const RULER_HEIGHT_PX = 22;
  // The arrangement's own row height, so aiming at row N keeps hitting row N
  // when the rows change size.
  const ROW_HEIGHT_PX = ROW_METRICS.trackHeightPx;
  const TICKS_PER_BAR = 768;
  fireAndFlush(() =>
    fireEvent.dblClick(canvas, {
      clientX: (TICKS_PER_BAR / 2) * PIXELS_PER_TICK,
      clientY: RULER_HEIGHT_PX + ROW_HEIGHT_PX * (rowIndex + 0.5),
    }),
  );
  return screen.findByRole("dialog", { name: "Sequence editor" });
}

/**
 * Moves to a view through the dock, the way a person does (`UI-001`): the
 * editor shows exactly one, so a test wanting another has to go there.
 */
async function goToView(label: "Arrangement" | "Instrument" | "Mixer"): Promise<void> {
  // The dock exists only once the project is open, so this is also the wait.
  const dock = await screen.findByRole("navigation", { name: "Views" });
  clickAndFlush(within(dock).getByRole("link", { name: label }));
  await vi.waitFor(() =>
    expect(dock.querySelector("[aria-current='page']")).toHaveTextContent(label),
  );
}

/** Null when the save state offers no retry: non-retryable, or not failed. */
function saveRetryButton(): HTMLElement | null {
  return within(saveStatusGroup()).queryByRole("button", { name: "Retry" });
}

// EditorView links back to the dashboard with a plain anchor, which the router
// only resolves from inside a matched route — so the editor is mounted over an
// in-memory history, which is Router 2's replacement for the old
// `<MemoryRouter><Route .../></MemoryRouter>` pair.
//
// The router carries the same three project paths the real table does
// (`src/router.tsx`) and derives the view from the address exactly as
// `routes/projects/Project.tsx` does, because the view *is* the address
// (`UI-001`): a harness that passed a view prop directly could not tell a
// working dock from one that navigates nowhere.
function renderEditor(
  projectId: string,
  options: {
    createAuditionEngine?: () => PreviewEngine;
    libraryClient?: LibraryClient;
    analytics?: Analytics;
  } = {},
) {
  const EditorView = EditorViewModule.default;
  const location = memoryHistory(editorViewPath(projectId, "arrangement"));
  const Page = () => {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <EditorView
        projectId={projectId}
        view={editorViewFromPath(location.pathname)}
        viewHref={(view) => editorViewPath(projectId, view)}
        onSelectView={(view) => navigate(editorViewPath(projectId, view))}
        createAuditionEngine={options.createAuditionEngine}
        libraryClient={options.libraryClient}
        analytics={options.analytics}
      />
    );
  };
  const TestRouter = createRouter({
    history: location,
    // The real table's shape (`src/router.tsx`): one route, not one per view,
    // so a switch does not remount the editor.
    routes: [{ path: "/projects/:id/:view?", component: Page }],
  });
  return { ...render(() => <TestRouter />), location };
}

/** A library sound as a drag hands it over, already in its wire form (#225). */
const DROPPED_HAT = {
  name: "Dropped Closed Hat",
  packId: "pak_SdlN_OazweXrwury0j27Y",
  packVersion: "1.0.0",
  kind: "sample",
  storageRef: "samples/starter-library/audio/sha256/ab/cd/abcd.wav",
  url: "/samples/starter-library/audio/sha256/ab/cd/abcd.wav",
  durationSeconds: 0.25,
  sampleRate: 48000,
  channelCount: 1,
  licence: "solid-groove-owned",
};

/** jsdom implements no `DataTransfer`; this is the slice a drop reads. */
function transferCarrying(sample: unknown) {
  const payload = JSON.stringify(sample);
  return {
    types: [LIBRARY_SAMPLE_MIME],
    getData: (format: string) => (format === LIBRARY_SAMPLE_MIME ? payload : ""),
    setData: () => {},
  };
}

/**
 * The name of the first loop in a committed fixture pack.
 *
 * Read from the manifest rather than written down, so a test that needs "a
 * loop" keeps pointing at one when the delivered library changes underneath
 * it — the same reason CF-005 finds its loop by reading the rows.
 */
function loopAssetName(slug: string): string {
  const manifest = parsePackManifest(fixturePackManifest(slug));
  const loop = packAssets(manifest).find((asset) => asset.type === "loop");
  if (!loop) throw new Error(`fixture pack "${slug}" ships no loop`);
  return loop.name;
}

function recordingAnalytics(
  transport: ReturnType<typeof createRecordingTransport>,
  consent: ConsentStore = new ConsentStore(memoryStorage()),
): Analytics {
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  return analytics;
}

describe("EditorView", () => {
  it("shows a loading state, then the 404 page for a project that does not exist", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();

    renderEditor("prj_doesnotexist00000000");

    expect(screen.getByText("Loading project")).toBeInTheDocument();
    expect(await screen.findByText("This groove is broken")).toBeInTheDocument();
  });

  it("loads a project and renders its step editor with the saved steps", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);

    const editor = await openSequenceEditor();
    expect(
      within(editor).getByRole("region", { name: "Step editor" }),
    ).toBeInTheDocument();
    // The slice fixture's four-on-the-floor clip: steps 1, 5, 9, 13 on the
    // single pitched "Notes" lane.
    expect(screen.getByRole("button", { name: "Notes, step 1, on" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Notes, step 2, off" }),
    ).toBeInTheDocument();
    // The track name appears in the step-editor's track-info header. (The
    // ARR-001 arrangement shell also lists it in its virtualized headers and
    // accessible track list, so scope this to the track editor.)
    expect(
      within(editor).getByText(project.song.tracks[0].name, { selector: ".track-name" }),
    ).toBeInTheDocument();
    // The reopened project reports the pack dependency it saved.
    const dependency = project.metadata.packDependencies[0];
    expect(
      screen.getByText(`Pack: ${dependency.packId} @ ${dependency.version}`),
    ).toBeInTheDocument();

    // Undo starts disabled: nothing has been edited yet in this session.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("renders the tempo-labelled loop panel for a project with an audio loop (LOOP-006)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createDrumMachineFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);

    // The loop is on the fixture's second track, so it is that row's clip the
    // sequence editor has to be opened on. The loop panel distinguishes a
    // tempo-labelled loop from a pitched one-shot and documents the alpha's
    // time-stretch behaviour.
    const editor = await openSequenceEditor(1);
    expect(
      within(editor).getByRole("region", { name: "Audio loop" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/tempo-labelled loop/i)).toBeInTheDocument();
    expect(screen.getByText(/time-stretch/i)).toBeInTheDocument();
    expect(screen.getByText(/preserves pitch/i)).toBeInTheDocument();
  });

  it("renders the piano roll (not the step grid) for a synth track's note clip (CLP-03)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createPianoRollFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);

    const editor = await openSequenceEditor();
    expect(
      within(editor).getByRole("region", { name: /Piano roll/ }),
    ).toBeInTheDocument();
    // The step editor is a two-dimensional pitch editor's poor fit, so a
    // synth note clip shows the piano roll instead.
    expect(screen.queryByRole("region", { name: "Step editor" })).not.toBeInTheDocument();
  });

  it("shows the sampler instrument panel for the slice's sampler track", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await openSequenceEditor();
    await goToView("Instrument");

    // Named for its track, because a drop has to land on a particular one.
    expect(
      await screen.findByRole("region", { name: "BD instrument" }),
    ).toBeInTheDocument();
    // The INS-01 sampler controls: pitch, sample start/end, amp envelope.
    expect(screen.getByLabelText("Pitch")).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toBeInTheDocument();
    expect(screen.getByLabelText("End")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audition" })).toBeInTheDocument();
    // It says what it is holding rather than offering a list of the project's
    // own samples to swap between (#225).
    const panel = screen.getByRole("region", { name: "BD instrument" });
    expect(within(panel).getByText("909 Bass Drum")).toBeInTheDocument();
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("loads a sound dropped from the library onto the sampler, undoably", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    const transport = createRecordingTransport();

    renderEditor(project.metadata.id, {
      analytics: recordingAnalytics(transport),
    });
    await openSequenceEditor();
    await goToView("Instrument");
    const panel = await screen.findByRole("region", {
      name: "BD instrument",
    });

    fireEvent.drop(panel, { dataTransfer: transferCarrying(DROPPED_HAT) });

    // The sampler names the dropped sound, and the project now carries it.
    expect(await screen.findByText(DROPPED_HAT.name)).toBeInTheDocument();
    const changed = transport.named("instrument_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].params.instrument_type).toBe("sampler");

    // Carrying the asset and pointing the sampler at it is one transaction, so
    // one undo takes the whole drop back.
    fireEvent.click(await screen.findByRole("button", { name: /^Undo/ }));
    expect(await screen.findByText("909 Bass Drum")).toBeInTheDocument();
  });

  it("inserts from the keyboard onto the same track a drop would reach", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id, {
      libraryClient: new LibraryClient(fixtureFetcher()),
    });

    // The project's own pack is a fixture pack with no delivered manifest, so
    // reach a real sound the way a user does with an empty shelf: open the
    // library from the slot, then the pack browser.
    await openLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Browse packs" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: /Core Electronic Drums/,
      }),
    );
    const insert = (
      await within(dialog).findAllByRole("button", { name: /^Insert / })
    )[0];
    const name = (insert.getAttribute("aria-label") ?? "").replace("Insert ", "");
    fireEvent.click(insert);

    // Inserting is what the library was opened for, so it closes on insert
    // and the slot behind it names the sound that landed.
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Library" })).not.toBeInTheDocument(),
    );
    const panel = await screen.findByRole("region", { name: "BD instrument" });
    expect(await within(panel).findByText(name)).toBeInTheDocument();
  });

  it("shows a track's instrument panel even before it has a clip (#228)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    // A track added from the mixer arrives with an instrument and no clip.
    // Its controls are the reason to select it, so the editor must not wait
    // for a clip before showing them.
    const fixture = createPianoRollFixtureProject();
    const project = {
      ...fixture,
      clips: [],
      song: { ...fixture.song, placements: [] },
    };
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await screen.findByTestId("arrangement-view-ready");

    // A track with no clip has nothing to open (UI-001): neither clip editor
    // is anywhere on the page, and nothing is open over the arrangement.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Piano roll/ })).not.toBeInTheDocument();

    // The instrument is still there to reach, which is the point (#228).
    await goToView("Instrument");
    expect(
      await screen.findByRole("region", { name: "Synth voice" }),
    ).toBeInTheDocument();
  });

  it("switches the editor to a track selected in the mixer (#228)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    // The drum fixture's two tracks: a drum machine, then an audio track.
    const project = createDrumMachineFixtureProject();
    const [drums, breakTrack] = project.song.tracks;
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);

    // It opens on the first track: the instrument view shows its pads.
    await goToView("Instrument");
    expect(
      await screen.findByRole("region", {
        name: `Drum machine: ${drums.name}`,
      }),
    ).toBeInTheDocument();

    // Selection is one piece of state across all three views (UI-001), so a
    // track chosen in the mixer is the one the instrument view shows.
    await goToView("Mixer");
    fireEvent.click(mixerSelect(breakTrack.name));
    // Solid 2 publishes a write on the next microtask, and
    // `@solidjs/testing-library` 1.x re-exports `@testing-library/dom`'s raw
    // `fireEvent`, so nothing flushes it for us. Without this the assertions
    // below read the selection as it was before the click.
    flush();

    await goToView("Instrument");
    expect(
      screen.queryByRole("region", { name: `Drum machine: ${drums.name}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: `${breakTrack.name} instrument` }),
    ).toBeInTheDocument();

    // And back, from the same control on the other strip.
    await goToView("Mixer");
    clickAndFlush(mixerSelect(drums.name));
    await goToView("Instrument");
    expect(
      screen.getByRole("region", { name: `Drum machine: ${drums.name}` }),
    ).toBeInTheDocument();
  });

  it("switches the editor to a track selected in the arrangement (#228)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createDrumMachineFixtureProject();
    const [drums, breakTrack] = project.song.tracks;
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await screen.findByTestId("arrangement-view-ready");

    // The arrangement's track header column: the same click a pointer makes
    // on a row, from the DOM side of the hybrid surface.
    clickAndFlush(
      within(screen.getByLabelText("Tracks")).getByRole("button", {
        name: `Edit ${breakTrack.name}`,
      }),
    );

    // Every view agrees on which track is selected (UI-001): the instrument
    // view has left the drum machine, and the mixer marks the new strip.
    await goToView("Instrument");
    expect(
      screen.queryByRole("region", { name: `Drum machine: ${drums.name}` }),
    ).not.toBeInTheDocument();
    await goToView("Mixer");
    expect(mixerSelect(breakTrack.name)).toHaveAttribute("aria-pressed", "true");
  });

  it("toggling a step enables undo, and undo reverts it", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await openSequenceEditor();

    paintStep("Notes, step 2, off");
    expect(
      await screen.findByRole("button", { name: "Notes, step 2, on" }),
    ).toBeInTheDocument();

    const undoButton = await screen.findByRole("button", { name: /^Undo/ });
    expect(undoButton).not.toBeDisabled();
    fireEvent.click(undoButton);

    expect(
      await screen.findByRole("button", { name: "Notes, step 2, off" }),
    ).toBeInTheDocument();
  });

  it("autosaves an edit, and the save status settles to Saved with an advanced revision", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    const startingRevision = project.metadata.revision;

    renderEditor(project.metadata.id);
    await openSequenceEditor();

    paintStep("Notes, step 2, off");

    const saveStatus = await screen.findByText("Saved", {}, { timeout: 3_000 });
    expect(
      Number(saveStatus.closest(".save-status")?.getAttribute("data-revision")),
    ).toBeGreaterThan(startingRevision);

    const loaded = await repository.loadProject(project.metadata.id);
    if (!loaded.ok) throw new Error("expected the project to load");
    const clip = loaded.value.clips[0];
    if (clip.content.kind !== "notes") throw new Error("expected a note clip");
    expect(clip.content.events).toHaveLength(5);
  });

  it("the save status revision keeps advancing across undo, so a stale echo cannot restore the undone note", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await openSequenceEditor();

    paintStep("Notes, step 2, off");
    await screen.findByText("Saved", {}, { timeout: 3_000 });
    const saveStatusEl = document.querySelector(".save-status");
    const revisionAfterAdd = Number(saveStatusEl?.getAttribute("data-revision"));

    const undoButton = await screen.findByRole("button", { name: /^Undo/ });
    fireEvent.click(undoButton);
    await screen.findByRole("button", { name: "Notes, step 2, off" });

    await vi.waitFor(() => {
      const revisionAfterUndo = Number(saveStatusEl?.getAttribute("data-revision"));
      expect(revisionAfterUndo).toBeGreaterThan(revisionAfterAdd);
    });

    const loaded = await repository.loadProject(project.metadata.id);
    if (!loaded.ok) throw new Error("expected the project to load");
    const clip = loaded.value.clips[0];
    if (clip.content.kind !== "notes") throw new Error("expected a note clip");
    // The undone note stayed undone in the persisted document too.
    expect(clip.content.events).toHaveLength(4);
  });

  it("shows an actionable Save failed state with an explicit retry, and recovers", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    repository.failNextWrites({ count: 1 });
    renderEditor(project.metadata.id);
    await openSequenceEditor();

    paintStep("Notes, step 2, off");

    await screen.findByText("Save failed", {}, { timeout: 3_000 });
    expect(
      within(saveStatusGroup()).getByText("Check your connection."),
    ).toBeInTheDocument();
    const retryButton = saveRetryButton();
    expect(retryButton).not.toBeNull();

    fireEvent.click(retryButton as HTMLElement);

    await screen.findByText("Saved", {}, { timeout: 3_000 });
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
    expect(saveRetryButton()).toBeNull();

    const loaded = await repository.loadProject(project.metadata.id);
    if (!loaded.ok) throw new Error("expected the project to load");
    const clip = loaded.value.clips[0];
    if (clip.content.kind !== "notes") throw new Error("expected a note clip");
    expect(clip.content.events).toHaveLength(5);
  });

  it("does not offer a retry button for a non-retryable failure", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await openSequenceEditor();

    // Another client's write lands in the store directly, without going
    // through `saveMetadata` (which would notify this session's own
    // `watchProject` listener and let it adopt the newer revision before the
    // edit below ever conflicts). That models the real race the revision
    // check exists for: the remote write reaches the server before this
    // tab's watcher has delivered word of it.
    const path = documentsModule.projectDocumentPath(project.metadata.id);
    const stored = repository.readDocument(path);
    if (!stored) throw new Error("expected the metadata document to exist");
    repository.writeDocument(path, {
      ...stored,
      revision: (stored.revision as number) + 1,
    });

    paintStep("Notes, step 2, off");

    await screen.findByText("Save failed", {}, { timeout: 3_000 });
    expect(
      screen.getByText("This project changed in another tab or session."),
    ).toBeInTheDocument();
    expect(saveRetryButton()).toBeNull();
  });
});

/**
 * The Library panel builds one audition engine per mount (LOOP-013). Toggling
 * the panel closed unmounts `LibraryBrowser`, whose `useLibraryBrowser` disposes
 * the engine; a `ToneAuditionEngine` stays disposed permanently, so a cached
 * single engine would be dead on the second open and every audition would then
 * fail with `asset_missing`. This asserts each open gets a fresh, live engine.
 */
describe("EditorView library audition engine lifecycle", () => {
  async function renderWithLibrary() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    const engines: ReturnType<typeof fakePreviewEngine>[] = [];
    renderEditor(project.metadata.id, {
      createAuditionEngine: () => {
        const engine = fakePreviewEngine();
        engines.push(engine);
        return engine;
      },
    });
    return { engines };
  }

  async function closeLibrary() {
    clickAndFlush(screen.getByRole("button", { name: "Close library" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Library" })).not.toBeInTheDocument(),
    );
  }

  it("builds a fresh, live engine on each open and disposes the closed one", async () => {
    const { engines } = await renderWithLibrary();

    // The library is closed until a slot opens it (UI-001), so no engine
    // exists until then.
    expect(engines).toHaveLength(0);
    await openLibrary();
    expect(engines).toHaveLength(1);
    expect(engines[0].disposed()).toBe(false);

    // Closing unmounts LibraryBrowser, which disposes that engine.
    await closeLibrary();
    await waitFor(() => expect(engines[0].disposed()).toBe(true));

    // Reopening builds a second, distinct, undisposed engine — never the dead
    // first one. Under the old cached-singleton bug this would still be
    // engines[0], now disposed, and audition would fail for the rest of the
    // session.
    clickAndFlush(screen.getByRole("button", { name: "Load a sound" }));
    await screen.findByRole("dialog", { name: "Library" });
    expect(engines).toHaveLength(2);
    expect(engines[1]).not.toBe(engines[0]);
    expect(engines[1].disposed()).toBe(false);

    // The fresh engine still starts an audition — the exact path the bug broke.
    await expect(
      engines[1].start({ id: "ast_x", url: "sound.wav" } as never, {
        sync: false,
      }),
    ).resolves.toBeDefined();
  });
});

/** The Instrument view's own layout (`UI-001`, CF-008). */
describe("EditorView instrument view", () => {
  async function renderDrums() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createDrumMachineFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id);
    await goToView("Instrument");
    return project;
  }

  const rail = () => screen.getByRole("list", { name: "Tracks" });

  it("lists every track down the rail and marks the one on screen", async () => {
    const project = await renderDrums();
    const [drums, breakTrack] = project.song.tracks;

    expect(within(rail()).getAllByRole("listitem")).toHaveLength(2);
    expect(rail()).toHaveTextContent(drums.name);
    expect(rail()).toHaveTextContent(breakTrack.name);
    expect(within(rail()).getByRole("button", { name: drums.name })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches tracks from the rail, which every other view follows", async () => {
    const project = await renderDrums();
    const [drums, breakTrack] = project.song.tracks;

    clickAndFlush(within(rail()).getByRole("button", { name: breakTrack.name }));

    expect(
      screen.getByRole("region", { name: `${breakTrack.name} instrument` }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: `Drum machine: ${drums.name}` }),
    ).not.toBeInTheDocument();
    // Selection is one piece of state (UI-001): the mixer marks it too.
    await goToView("Mixer");
    expect(mixerSelect(breakTrack.name)).toHaveAttribute("aria-pressed", "true");
  });

  it("shows only the instrument: the timeline is not on the page", async () => {
    await renderDrums();

    expect(screen.queryByTestId("arrangement-view-ready")).not.toBeInTheDocument();
    // ...and the device chain has a labelled home waiting for #241.
    expect(screen.getByRole("region", { name: "Device chain" })).toBeVisible();
  });
});

/** Adding a track, from either surface that offers it (`UI-001`, #223). */
describe("EditorView new-track unit", () => {
  async function renderSlice(transport: ReturnType<typeof createRecordingTransport>) {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id, { analytics: recordingAnalytics(transport) });
    await screen.findByTestId("arrangement-view-ready");
  }

  const trackRows = () =>
    within(screen.getByLabelText("Arrangement tracks")).getAllByRole("listitem");

  it("offers every registered kind on the arrangement, and creates one", async () => {
    const transport = createRecordingTransport();
    await renderSlice(transport);
    const unit = screen.getByRole("group", { name: "Add track to the arrangement" });

    // From the shared kind table, not a list written into the view.
    for (const spec of NEW_TRACK_KINDS) {
      expect(within(unit).getByRole("button", { name: spec.actionLabel })).toBeVisible();
    }
    expect(trackRows()).toHaveLength(1);

    clickAndFlush(within(unit).getByRole("button", { name: "Add sampler track" }));

    await vi.waitFor(() => expect(trackRows()).toHaveLength(2));
    // One `track.add`, so one undo takes the whole track back.
    const undo = screen.getByRole("button", { name: /^Undo / });
    clickAndFlush(undo);
    await vi.waitFor(() => expect(trackRows()).toHaveLength(1));
    const added = transport.events.filter((event) => event.name === "track_added");
    expect(added).toHaveLength(1);
    expect(added[0].params).toEqual(
      expect.objectContaining({ track_type: "instrument", instrument_type: "sampler" }),
    );
  });

  it("opens the library on loops from the Loop button beside them", async () => {
    // An audio track needs content to exist, so the way to start one is to
    // pick the loop (UI-001).
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id, {
      createAuditionEngine: () => fakePreviewEngine(),
      libraryClient: new LibraryClient(fixtureFetcher()),
    });
    await screen.findByTestId("arrangement-view-ready");

    clickAndFlush(screen.getByRole("button", { name: "Add loop track" }));

    const library = await screen.findByRole("dialog", { name: "Library" });
    // It says what it is showing, without renaming the region underneath it.
    expect(within(library).getByRole("heading", { name: "Loops" })).toBeVisible();
    expect(within(library).getByRole("region", { name: "Library" })).toBeVisible();
  });

  it("inserting a loop adds a track carrying it, and closes the library", async () => {
    // The regression this exists for: the Loop button opened the library, and
    // "Insert" reached a sampler-only path that returned silently because no
    // sampler was selected. The window closed, the project was untouched, and
    // nothing was logged or thrown — a dead end that looked like success.
    const transport = createRecordingTransport();
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id, {
      createAuditionEngine: () => fakePreviewEngine(),
      libraryClient: new LibraryClient(fixtureFetcher()),
      analytics: recordingAnalytics(transport),
    });
    await screen.findByTestId("arrangement-view-ready");
    const before = trackRows().length;

    clickAndFlush(screen.getByRole("button", { name: "Add loop track" }));
    const library = await screen.findByRole("dialog", { name: "Library" });

    // The fixture project's own pack has no delivered manifest, so a real loop
    // is reached the way a user does with an empty shelf: through the pack
    // browser. Filtered to loops, so whatever it offers is one.
    expect(within(library).getByRole("heading", { name: "Loops" })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Browse packs" }));
    const packs = await screen.findByRole("dialog");
    fireEvent.click(
      await within(packs).findByRole("button", { name: /Core Electronic Drums/ }),
    );

    // The loop specifically, not whatever the pack lists first — the pack
    // browser offers that pack's one-shots too, and a one-shot takes the
    // sampler path instead. Its name comes from the committed manifest, so
    // this keeps pointing at a loop as the fixture library changes.
    const loopName = loopAssetName("core-electronic-drums");
    const insert = await within(packs).findByRole("button", {
      name: `Insert ${loopName}`,
    });
    fireEvent.click(insert);

    // A track appears, named for the loop, and the window closes behind it.
    await vi.waitFor(() => expect(trackRows()).toHaveLength(before + 1));
    expect(trackRows().at(-1)).toHaveTextContent(loopName);
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Library" })).toBeNull(),
    );

    // One track_added, reporting an audio track and no instrument — the case
    // the catalog leaves `instrument_type` optional for.
    const added = transport.events.filter((event) => event.name === "track_added");
    expect(added).toHaveLength(1);
    expect(added[0].params).toEqual(expect.objectContaining({ track_type: "audio" }));
    expect(added[0].params).not.toHaveProperty("instrument_type");

    // One undo takes the whole insertion back, track and all.
    clickAndFlush(screen.getByRole("button", { name: /^Undo / }));
    await vi.waitFor(() => expect(trackRows()).toHaveLength(before));
  });

  it("reaches the same outcome from the mixer, through the same route", async () => {
    const transport = createRecordingTransport();
    await renderSlice(transport);

    await goToView("Mixer");
    clickAndFlush(
      within(screen.getByRole("group", { name: "Add track" })).getByRole("button", {
        name: "Add synth track",
      }),
    );

    await goToView("Arrangement");
    await vi.waitFor(() => expect(trackRows()).toHaveLength(2));
    const added = transport.events.filter((event) => event.name === "track_added");
    expect(added).toHaveLength(1);
    expect(added[0].params).toEqual(
      expect.objectContaining({ track_type: "instrument", instrument_type: "synth" }),
    );
  });
});

/** The library, as a window opened from a slot (`UI-001`). */
describe("EditorView library modal", () => {
  async function renderSlice() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id, {
      createAuditionEngine: () => fakePreviewEngine(),
      libraryClient: new LibraryClient(fixtureFetcher()),
    });
  }

  it("is not on the page until a slot asks for it", async () => {
    await renderSlice();
    await screen.findByTestId("arrangement-view-ready");

    // The arrangement is full bleed: the column that used to live beside it
    // is gone, and so is the header toggle that opened and closed it.
    expect(screen.queryByRole("region", { name: "Library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Library" })).not.toBeInTheDocument();
  });

  it("opens from the sampler's sample slot, and closes again", async () => {
    await renderSlice();

    const library = await openLibrary();
    expect(library).toHaveAttribute("aria-modal", "true");
    expect(within(library).getByRole("region", { name: "Library" })).toBeVisible();

    clickAndFlush(within(library).getByRole("button", { name: "Close library" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Library" })).not.toBeInTheDocument(),
    );
  });
});

/** The PRD KEY-01/KEY-02 wiring, end to end through the real registry. */
describe("EditorView keyboard shortcuts", () => {
  async function renderSlice() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id);
    await openSequenceEditor();
    return project;
  }

  it("undoes an edit from the keyboard, through the same command path as the button", async () => {
    await renderSlice();

    paintStep("Notes, step 2, off");
    await screen.findByRole("button", { name: "Notes, step 2, on" });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(
      await screen.findByRole("button", { name: "Notes, step 2, off" }),
    ).toBeInTheDocument();
  });

  it("does nothing when the undo shortcut fires with nothing to undo", async () => {
    await renderSlice();

    // Undo is registered but disabled, so the mapping resolves and stops.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Notes, step 1, on" })).toBeInTheDocument();
  });

  it("does not fire a shortcut typed into a text field", async () => {
    await renderSlice();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    fireEvent.keyDown(input, { key: "?" });

    expect(
      screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
    input.remove();
  });

  it("opens the mapping guide with ?, closes it with Escape, and restores focus", async () => {
    await renderSlice();
    const opener = screen.getByRole("button", { name: "Keyboard shortcuts" });
    opener.focus();

    fireEvent.keyDown(window, { key: "?", shiftKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByLabelText("Search shortcuts"));

    fireEvent.keyDown(window, { key: "Escape" });

    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(opener);
  });

  it("does not toggle playback while the guide is open", async () => {
    await renderSlice();

    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });

    fireEvent.keyDown(window, { key: " " });

    // The transport button still offers Play, so Space never reached it.
    expect(screen.getByRole("button", { name: "Start playback" })).toBeInTheDocument();
  });

  it("does not toggle playback while the pack browser is open, and Escape closes it", async () => {
    await renderSlice();

    // The pack browser is a modal surface like the guide, so it takes the
    // keyboard the same way (PRD KEY-02). It opens from the library, which
    // since UI-001 is itself a modal opened from a slot.
    await openLibrary();
    fireEvent.click(await screen.findByRole("button", { name: /Browse packs/ }));
    await screen.findByRole("dialog", { name: /packs/i });

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Start playback" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /packs/i })).not.toBeInTheDocument(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Library" })).not.toBeInTheDocument(),
    );
    // With the modal gone the editor context has the keyboard back: `?` is an
    // `editor`-context mapping, so it only fires once nothing is suppressing it.
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(
      await screen.findByRole("searchbox", { name: "Search shortcuts" }),
    ).toBeInTheDocument();
  });

  it("shows each action's mapping in its tooltip, from the registry", async () => {
    await renderSlice();

    const platform = detectPlatform();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute(
      "title",
      `Undo (${shortcutLabel("edit.undo", platform)})`,
    );
    expect(screen.getByRole("button", { name: "Start playback" })).toHaveAttribute(
      "title",
      "Play (Space)",
    );
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveAttribute(
      "title",
      "Keyboard shortcuts (?)",
    );
  });

  it("deletes a selected arrangement placement from the keyboard (ARR-002)", async () => {
    const project = await renderSlice();
    const placementId = project.song.placements[0].id;

    // Select the fixture's one placement (tick 0..TICKS_PER_BAR, row 0) by
    // pointer, the same way a user would, then delete it with the KEY-01
    // mapping — not by calling the controller directly, so this proves the
    // arrangement shortcut context actually reaches the command layer.
    const canvas = document.querySelector(".arrangement-layer-interactive");
    if (!canvas) throw new Error("no arrangement interaction canvas rendered");
    const PIXELS_PER_TICK = 0.08;
    const RULER_HEIGHT_PX = 22;
    const ROW_HEIGHT_PX = 28;
    const TICKS_PER_BAR = 768;
    const down = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: (TICKS_PER_BAR / 2) * PIXELS_PER_TICK,
      clientY: RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2,
    });
    Object.defineProperty(down, "pointerId", { value: 1 });
    fireEvent(canvas, down);
    const up = new MouseEvent("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperty(up, "pointerId", { value: 1 });
    fireEvent(canvas, up);
    await waitFor(() => {
      expect(
        document.querySelector(`[data-selected-placement="${placementId}"]`),
      ).not.toBeNull();
    });

    fireEvent.keyDown(window, { key: "Delete" });
    await screen.findByText("Saved", {}, { timeout: 3_000 });

    const loaded = await repository.loadProject(project.metadata.id);
    if (!loaded.ok) throw new Error("expected the project to load");
    expect(
      loaded.value.song.placements.find((p) => p.id === placementId),
    ).toBeUndefined();
  });

  /**
   * Clicks the first bar of the first arrangement row, where the piano-roll
   * fixture's placement sits, and waits for the accessible selection mirror to
   * show it. The geometry constants mirror the renderer's own — the canvas has
   * no DOM nodes to query for a hit.
   */
  async function selectPlacementInArrangement(placementId: string): Promise<void> {
    const canvas = document.querySelector(".arrangement-layer-interactive");
    if (!canvas) throw new Error("no arrangement interaction canvas rendered");
    const PIXELS_PER_TICK = 0.08;
    const RULER_HEIGHT_PX = 22;
    const ROW_HEIGHT_PX = 28;
    const TICKS_PER_BAR = 768;
    const down = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: (TICKS_PER_BAR / 2) * PIXELS_PER_TICK,
      clientY: RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2,
    });
    Object.defineProperty(down, "pointerId", { value: 1 });
    fireEvent(canvas, down);
    const up = new MouseEvent("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperty(up, "pointerId", { value: 1 });
    fireEvent(canvas, up);
    await waitFor(() => {
      expect(
        document.querySelector(`[data-selected-placement="${placementId}"]`),
      ).not.toBeNull();
    });
  }

  // #258. The reporter hit this by selecting a placement on one track, deleting
  // it, then selecting one on another track — but moving between tracks is
  // incidental. What decides it is the *edited* track's instrument, which
  // clicking a placement re-points (#228): once that track is one the editor
  // shows the piano roll for, the arrangement's placement selection stopped
  // reaching `edit.delete` at all, so Delete did nothing. The piano-roll
  // fixture is the smallest case — one synth track, one placement, no track
  // switching anywhere.
  it("deletes a selected placement while the piano roll is showing (#258)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createPianoRollFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id);
    await screen.findByTestId("arrangement-view-ready");

    const placementId = project.song.placements[0].id;
    await selectPlacementInArrangement(placementId);

    fireEvent.keyDown(window, { key: "Delete" });

    // Asserted against the stored project rather than the "Saved" indicator, so
    // a failure names the placement that is still there instead of dumping the
    // editor's DOM.
    await waitFor(
      async () => {
        const loaded = await repository.loadProject(project.metadata.id);
        if (!loaded.ok) throw new Error("expected the project to load");
        expect(loaded.value.song.placements.map((p) => p.id)).not.toContain(placementId);
      },
      { timeout: 3_000 },
    );
  });

  // #258 again, found by walking the preview channel: Delete, Cut and Copy all
  // came back, but Paste stayed dead on a piano-roll track. Its `isEnabled`
  // carried the same `!showPianoRoll()` term the rest of this handler block
  // shed — and because a disabled mapping leaves the browser default alone,
  // the failure is silent. The registry lists `edit.paste` under both
  // `selection` and `arrangement`, so the context was active the whole time
  // and only this gate stood in the way. Nothing is stolen from the roll: it
  // registers no clipboard action of its own (`PianoRollActions` is delete,
  // duplicate, select-all, has-selection).
  it("pastes a copied placement while the piano roll is showing (#258)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createPianoRollFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id);
    await screen.findByTestId("arrangement-view-ready");

    const placementId = project.song.placements[0].id;
    await selectPlacementInArrangement(placementId);

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    await waitFor(
      async () => {
        const loaded = await repository.loadProject(project.metadata.id);
        if (!loaded.ok) throw new Error("expected the project to load");
        expect(loaded.value.song.placements).toHaveLength(2);
      },
      { timeout: 3_000 },
    );
  });
});

/** The LOOP-003 transport surface: tempo, 4/4 display, loop, and metronome. */
/**
 * Opens the library from the sampler's sample slot (`UI-001`), which is the
 * only way in now that the always-on column is gone.
 */
async function openLibrary(): Promise<HTMLElement> {
  await goToView("Instrument");
  clickAndFlush(await screen.findByRole("button", { name: "Load a sound" }));
  return screen.findByRole("dialog", { name: "Library" });
}

/** A pointer event at bar 1 of the first arrangement row, where the slice
 * fixture's only placement sits. The canvas has no DOM node to aim at. */
function firePointerAtStarterClip(canvas: Element, type: string): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: (768 / 2) * 0.08,
    clientY: 22 + 28 / 2,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireAndFlush(() => fireEvent(canvas, event));
}

/** The sequence editor a clip opens into (`UI-001`, CF-001 and CF-008). */
describe("EditorView sequence editor", () => {
  async function renderSlice() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    return { ...renderEditor(project.metadata.id), project };
  }

  it("is not on the page until a clip is opened", async () => {
    await renderSlice();
    await screen.findByTestId("arrangement-view-ready");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step editor" })).not.toBeInTheDocument();
  });

  it("opens on the clip that was double-clicked, and closes with Escape", async () => {
    await renderSlice();
    const editor = await openSequenceEditor();

    expect(
      within(editor).getByRole("button", { name: "Notes, step 1, on" }),
    ).toBeVisible();

    fireAndFlush(() => fireEvent.keyDown(window, { key: "Escape" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The arrangement is underneath, exactly as it was.
    expect(screen.getByTestId("arrangement-view-ready")).toBeInTheDocument();
  });

  it("keeps the transport and the view switches working while it is open", async () => {
    // It is `role="dialog"` to a screen reader but NOT the shortcut layer's
    // `dialog` context — the distinction UI-001 turns on, and the one a
    // `dialog` context would silently undo.
    const { location, project } = await renderSlice();
    await openSequenceEditor();

    fireAndFlush(() => fireEvent.keyDown(window, { key: "3" }));
    await vi.waitFor(() =>
      expect(location.get()).toBe(`/projects/${project.metadata.id}/mixer`),
    );

    // The metronome rather than play/stop: both are `editor`-context transport
    // mappings, and this one settles synchronously where starting playback in
    // jsdom depends on an `AudioContext` that never resumes here.
    fireAndFlush(() => fireEvent.keyDown(window, { key: "o" }));
    expect(screen.getByRole("button", { name: "Disable metronome" })).toBeVisible();
  });

  it("closes when the placement it was opened on goes away", async () => {
    await renderSlice();
    await screen.findByTestId("arrangement-view-ready");
    const canvas = document.querySelector(".arrangement-layer-interactive");
    if (!canvas) throw new Error("no arrangement interaction canvas rendered");
    // Select the placement, then open it: deleting it leaves the editor with
    // nothing to be open on, and it must go rather than sit on a clip the
    // project no longer places.
    firePointerAtStarterClip(canvas, "pointerdown");
    firePointerAtStarterClip(canvas, "pointerup");
    await openSequenceEditor();

    fireAndFlush(() => fireEvent.keyDown(window, { key: "Delete" }));

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

/** The three views and the dock that names them (`UI-001`, CF-008). */
describe("EditorView views", () => {
  async function renderViews(analytics?: Analytics) {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    const rendered = renderEditor(project.metadata.id, { analytics });
    await screen.findByTestId("arrangement-view-ready");
    return { ...rendered, projectId: project.metadata.id };
  }

  const dock = () => screen.getByRole("navigation", { name: "Views" });
  const currentView = () => dock().querySelector("[aria-current='page']");
  const viewLink = (name: string) => within(dock()).getByRole("link", { name });

  /** Router 2 navigates on its own schedule, so the address and the dock's
   * marker are awaited together rather than read the instant an event fires. */
  async function atView(
    location: { get(): string; back(): void },
    path: string,
    label: string,
  ): Promise<void> {
    await vi.waitFor(() => {
      expect(location.get()).toBe(path);
      expect(currentView()).toHaveTextContent(label);
    });
  }

  it("opens a project on the arrangement, at the bare project address", async () => {
    const { location, projectId } = await renderViews();

    expect(location.get()).toBe(`/projects/${projectId}`);
    expect(currentView()).toHaveTextContent("Arrangement");
  });

  it("moves to a view from the dock, and the address follows", async () => {
    const { location, projectId } = await renderViews();

    clickAndFlush(viewLink("Mixer"));

    await atView(location, `/projects/${projectId}/mixer`, "Mixer");
  });

  it("moves to a view with 1/2/3, through the shortcut registry", async () => {
    const { location, projectId } = await renderViews();

    fireAndFlush(() => fireEvent.keyDown(window, { key: "2" }));
    await atView(location, `/projects/${projectId}/instrument`, "Instrument");

    fireAndFlush(() => fireEvent.keyDown(window, { key: "1" }));
    await atView(location, `/projects/${projectId}`, "Arrangement");
  });

  it("moves back through the views with the browser's back button", async () => {
    // A view is an address, so the history stack is what moving between them
    // produces — the half of "in the URL" a session-scoped signal would fail.
    const { location, projectId } = await renderViews();

    clickAndFlush(viewLink("Mixer"));
    await atView(location, `/projects/${projectId}/mixer`, "Mixer");
    fireAndFlush(() => fireEvent.keyDown(window, { key: "2" }));
    await atView(location, `/projects/${projectId}/instrument`, "Instrument");

    location.back();
    await atView(location, `/projects/${projectId}/mixer`, "Mixer");
    location.back();
    await atView(location, `/projects/${projectId}`, "Arrangement");
  });

  it("logs view_changed once per switch, saying how the view was reached", async () => {
    const transport = createRecordingTransport();
    await renderViews(recordingAnalytics(transport));

    clickAndFlush(viewLink("Mixer"));
    await vi.waitFor(() => expect(currentView()).toHaveTextContent("Mixer"));
    fireAndFlush(() => fireEvent.keyDown(window, { key: "2" }));
    await vi.waitFor(() => expect(currentView()).toHaveTextContent("Instrument"));

    const switches = transport.events.filter((event) => event.name === "view_changed");
    expect(switches.map((event) => event.params)).toEqual([
      expect.objectContaining({ view: "mixer", via: "dock" }),
      expect.objectContaining({ view: "instrument", via: "keyboard" }),
    ]);
  });

  it("logs nothing for arriving, or for asking for the view already on screen", async () => {
    const transport = createRecordingTransport();
    await renderViews(recordingAnalytics(transport));

    // Opening a project is not a switch — `project_opened` measures that.
    expect(transport.events.some((event) => event.name === "view_changed")).toBe(false);

    clickAndFlush(viewLink("Arrangement"));
    fireAndFlush(() => fireEvent.keyDown(window, { key: "1" }));
    await Promise.resolve();

    expect(transport.events.some((event) => event.name === "view_changed")).toBe(false);
  });

  it("keeps one editing session across a switch, rather than remounting", async () => {
    const { location, projectId } = await renderViews();

    // Undo history is session-local and dies with the component, so an undo
    // that survives a switch is proof the editor was not remounted — which is
    // what "switching views never rebuilds audio nodes or loses transport
    // position" rests on, since the audio graph has the same lifetime.
    await openSequenceEditor();
    paintStep("Notes, step 2, off");
    await screen.findByRole("button", { name: "Notes, step 2, on" });
    const undoBefore = screen.getByRole("button", { name: /^Undo / });

    clickAndFlush(viewLink("Mixer"));
    await atView(location, `/projects/${projectId}/mixer`, "Mixer");

    const undoAfter = screen.getByRole("button", { name: /^Undo / });
    expect(undoAfter).toBeEnabled();
    expect(undoAfter.getAttribute("aria-label")).toBe(
      undoBefore.getAttribute("aria-label"),
    );
  });

  it("changes nothing about switching when analytics is disabled", async () => {
    const transport = createRecordingTransport();
    const consent = new ConsentStore(memoryStorage());
    consent.set({ productAnalytics: false });
    const { location, projectId } = await renderViews(
      recordingAnalytics(transport, consent),
    );

    clickAndFlush(viewLink("Mixer"));

    await atView(location, `/projects/${projectId}/mixer`, "Mixer");
    expect(transport.events).toHaveLength(0);
  });
});

describe("EditorView transport controls (PRD AUD-01/AUD-02)", () => {
  async function renderSlice() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id);
    await openSequenceEditor();
    return project;
  }

  it("shows the fixed 4/4 time signature and a starting playhead", async () => {
    await renderSlice();
    // Both are plain text with a visually hidden prefix naming them, rather
    // than a role="img" whose aria-label repeats the text it already contains.
    expect(screen.getByTitle("Time signature (fixed at 4/4)")).toHaveTextContent(
      "Time signature 4/4",
    );
    expect(screen.getByTitle("Playhead (bar.beat)")).toHaveTextContent(
      "Playhead at bar 1.1",
    );
  });

  it("toggles the loop through the command layer, reflecting its pressed state", async () => {
    await renderSlice();

    // LOOP-017: a project opens with looping on, and the button reads the
    // toggle off the project rather than holding it.
    const loop = screen.getByRole("button", { name: "Disable loop" });
    expect(loop).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(loop);

    const loopOff = await screen.findByRole("button", { name: "Enable loop" });
    expect(loopOff).toHaveAttribute("aria-pressed", "false");
    // Undoable, so the toggle really travelled through a command rather than
    // being written onto the transport behind the project's back.
    expect(
      await screen.findByRole("button", { name: "Undo Turn looping off" }),
    ).not.toBeDisabled();

    fireEvent.click(loopOff);
    expect(await screen.findByRole("button", { name: "Disable loop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles the metronome, reflecting its pressed state", async () => {
    await renderSlice();

    const metronome = screen.getByRole("button", { name: "Enable metronome" });
    expect(metronome).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(metronome);
    const metronomeOn = await screen.findByRole("button", {
      name: "Disable metronome",
    });
    expect(metronomeOn).toHaveAttribute("aria-pressed", "true");
  });

  it("dispatches a clamped tempo command from the BPM input", async () => {
    await renderSlice();
    const tempo = screen.getByRole("spinbutton", { name: "Tempo (BPM)" });
    expect(tempo).toHaveAttribute("min", "40");
    expect(tempo).toHaveAttribute("max", "240");

    // 999 is above the supported range, so the command records the clamped 240.
    fireEvent.change(tempo, { target: { value: "999" } });

    const undo = await screen.findByRole("button", {
      name: "Undo Set Tempo to 240 BPM",
    });
    expect(undo).not.toBeDisabled();
    // The input reads back from `song.tempo`, so the displayed value proves the
    // command is the path the tempo travelled — this surface never writes it a
    // second time straight onto the transport.
    expect(tempo).toHaveValue(240);
  });

  it("the metronome shortcut O toggles the click from the keyboard", async () => {
    await renderSlice();
    expect(screen.getByRole("button", { name: "Enable metronome" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "o" });

    expect(
      await screen.findByRole("button", { name: "Disable metronome" }),
    ).toBeInTheDocument();
  });
});
