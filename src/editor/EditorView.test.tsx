import { createRouter, memoryHistory } from "@solidjs/router";
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
import { installWebAudioGlobals } from "../audio/testAudioContext";
import {
  createDrumMachineFixtureProject,
  createPianoRollFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { fakePreviewEngine } from "../library/__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "../library/__fixtures__/fixtures";
import { LIBRARY_SAMPLE_MIME } from "../library/assetDrag";
import type { PreviewEngine } from "../library/audition";
import { LibraryClient } from "../library/libraryClient";
import type { InMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { detectPlatform, shortcutLabel } from "../shortcuts";
import { clickAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";

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

/** Null when the save state offers no retry: non-retryable, or not failed. */
function saveRetryButton(): HTMLElement | null {
  return within(saveStatusGroup()).queryByRole("button", { name: "Retry" });
}

// EditorView links back to the dashboard with a plain anchor, which the router
// only resolves from inside a matched route — so the editor is mounted as the
// component of a one-route router over an in-memory history, which is Router
// 2's replacement for the old `<MemoryRouter><Route .../></MemoryRouter>` pair.
function renderEditor(
  projectId: string,
  options: {
    createAuditionEngine?: () => PreviewEngine;
    libraryClient?: LibraryClient;
    analytics?: Analytics;
  } = {},
) {
  const EditorView = EditorViewModule.default;
  const TestRouter = createRouter({
    history: memoryHistory("/"),
    routes: [
      {
        path: "/",
        component: () => (
          <EditorView
            projectId={projectId}
            createAuditionEngine={options.createAuditionEngine}
            libraryClient={options.libraryClient}
            analytics={options.analytics}
          />
        ),
      },
    ],
  });
  return render(() => <TestRouter />);
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

function recordingAnalytics(
  transport: ReturnType<typeof createRecordingTransport>,
): Analytics {
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
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

    expect(
      await screen.findByRole("region", { name: "Step editor" }),
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
    const trackEditor = document.querySelector(".track-editor");
    expect(trackEditor).not.toBeNull();
    expect(
      within(trackEditor as HTMLElement).getByText(project.song.tracks[0].name),
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

    // The loop panel distinguishes a tempo-labelled loop from a pitched
    // one-shot and documents the alpha's time-stretch behaviour.
    expect(await screen.findByRole("region", { name: "Audio loop" })).toBeInTheDocument();
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

    expect(await screen.findByRole("region", { name: /Piano roll/ })).toBeInTheDocument();
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
    // reach a real sound the way a user does with an empty shelf: the pack
    // browser.
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

    expect(
      await screen.findByRole("region", { name: "Synth voice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This track has no clip yet.")).toBeInTheDocument();
    // Neither clip editor is on screen: there is no clip to program.
    expect(screen.queryByRole("region", { name: "Step editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Piano roll/ })).not.toBeInTheDocument();
  });

  it("switches the editor to a track selected in the mixer (#228)", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    // The drum fixture's two tracks: a drum machine, then an audio track.
    const project = createDrumMachineFixtureProject();
    const [drums, breakTrack] = project.song.tracks;
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);

    // It opens on the first track: the drum machine's pads.
    expect(
      await screen.findByRole("region", {
        name: `Drum machine: ${drums.name}`,
      }),
    ).toBeInTheDocument();

    fireEvent.click(mixerSelect(breakTrack.name));
    // Solid 2 publishes a write on the next microtask, and
    // `@solidjs/testing-library` 1.x re-exports `@testing-library/dom`'s raw
    // `fireEvent`, so nothing flushes it for us. Without this the assertions
    // below read the selection as it was before the click.
    flush();

    // The editor follows: the second track's name, and no drum pads, because
    // the pads belong to a track that is no longer the one being edited.
    const trackEditor = document.querySelector(".track-editor");
    expect(trackEditor).not.toBeNull();
    expect(
      within(trackEditor as HTMLElement).getByText(breakTrack.name),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: `Drum machine: ${drums.name}` }),
    ).not.toBeInTheDocument();

    // And back, from the same control on the other strip.
    clickAndFlush(mixerSelect(drums.name));
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
    await screen.findByRole("region", {
      name: `Drum machine: ${drums.name}`,
    });

    // The arrangement's track header column: the same click a pointer makes
    // on a row, from the DOM side of the hybrid surface.
    clickAndFlush(
      within(screen.getByLabelText("Tracks")).getByRole("button", {
        name: `Edit ${breakTrack.name}`,
      }),
    );

    expect(
      screen.queryByRole("region", { name: `Drum machine: ${drums.name}` }),
    ).not.toBeInTheDocument();
    // Both surfaces agree on which track is selected: the mixer marks it too.
    expect(mixerSelect(breakTrack.name)).toHaveAttribute("aria-pressed", "true");
  });

  it("toggling a step enables undo, and undo reverts it", async () => {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");

    renderEditor(project.metadata.id);
    await screen.findByRole("region", { name: "Step editor" });

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
    await screen.findByRole("region", { name: "Step editor" });

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
    await screen.findByRole("region", { name: "Step editor" });

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
    await screen.findByRole("region", { name: "Step editor" });

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
    await screen.findByRole("region", { name: "Step editor" });

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
    await screen.findByRole("region", { name: "Step editor" });
    return { engines };
  }

  function toggleLibrary() {
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
  }

  it("builds a fresh, live engine on each open and disposes the closed one", async () => {
    const { engines } = await renderWithLibrary();

    // The panel is open from the first paint (#221), so mounting the editor is
    // itself the first open and builds one engine.
    await screen.findByRole("complementary", { name: "Library" });
    expect(engines).toHaveLength(1);
    expect(engines[0].disposed()).toBe(false);

    // Closing the panel unmounts LibraryBrowser, which disposes that engine.
    toggleLibrary();
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Library" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(engines[0].disposed()).toBe(true));

    // Reopening builds a second, distinct, undisposed engine — never the dead
    // first one. Under the old cached-singleton bug this would still be
    // engines[0], now disposed, and audition would fail for the rest of the
    // session. Opening by default does not change that: the toggle still
    // unmounts and remounts the panel.
    toggleLibrary();
    await screen.findByRole("complementary", { name: "Library" });
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

/**
 * Where the library sits and whether it is there to begin with (#221). A sound
 * browser is the first thing a new project needs, so it is open on arrival, and
 * it is a column to the left of the arrangement rather than a band under it.
 */
describe("EditorView library panel placement", () => {
  async function renderSlice() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id, {
      createAuditionEngine: () => fakePreviewEngine(),
    });
    await screen.findByRole("region", { name: "Step editor" });
  }

  it("shows the library without anyone touching the toggle", async () => {
    await renderSlice();

    expect(
      await screen.findByRole("complementary", { name: "Library" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("puts the library beside the arrangement, not above or below it", async () => {
    await renderSlice();
    const library = await screen.findByRole("complementary", {
      name: "Library",
    });
    const arrangement = screen.getByTestId("arrangement-view-ready");

    // Siblings in the same row: the library's parent is the flex row that also
    // holds the column the arrangement lives in. If the arrangement were still
    // stacked above the library, the two would not share a row — the library
    // would sit inside a container that follows the arrangement's own.
    const row = library.parentElement;
    expect(row).not.toBeNull();
    expect(row).toHaveClass("editor-body");
    const arrangementColumn = row?.querySelector(".editor-main");
    expect(arrangementColumn).not.toBeNull();
    expect(arrangementColumn?.contains(arrangement)).toBe(true);
    // To the left: the library comes first among that row's children.
    expect(row?.firstElementChild).toBe(library);
  });

  it("still closes and reopens from the header toggle", async () => {
    await renderSlice();
    const toggle = screen.getByRole("button", { name: "Library" });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Library" }),
      ).not.toBeInTheDocument(),
    );
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(
      await screen.findByRole("complementary", { name: "Library" }),
    ).toBeInTheDocument();
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
    await screen.findByRole("region", { name: "Step editor" });
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

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    input.remove();
  });

  it("opens the mapping guide with ?, closes it with Escape, and restores focus", async () => {
    await renderSlice();
    const opener = screen.getByRole("button", { name: "Keyboard shortcuts" });
    opener.focus();

    fireEvent.keyDown(window, { key: "?", shiftKey: true });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByLabelText("Search shortcuts"));

    fireEvent.keyDown(window, { key: "Escape" });

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it("does not toggle playback while the guide is open", async () => {
    await renderSlice();

    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: " " });

    // The transport button still offers Play, so Space never reached it.
    expect(screen.getByRole("button", { name: "Start playback" })).toBeInTheDocument();
  });

  it("does not toggle playback while the pack browser is open, and Escape closes it", async () => {
    await renderSlice();

    // The pack browser is a modal surface like the guide, so it takes the
    // keyboard the same way (PRD KEY-02). The library panel it opens from is
    // already on screen — it starts open (#221).
    fireEvent.click(await screen.findByRole("button", { name: /Browse packs/ }));
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Start playback" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
});

/** The LOOP-003 transport surface: tempo, 4/4 display, loop, and metronome. */
describe("EditorView transport controls (PRD AUD-01/AUD-02)", () => {
  async function renderSlice() {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id);
    await screen.findByRole("region", { name: "Step editor" });
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

  it("toggles the loop and the metronome, reflecting their pressed state", async () => {
    await renderSlice();

    const loop = screen.getByRole("button", { name: "Enable loop" });
    expect(loop).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(loop);
    const loopOn = await screen.findByRole("button", { name: "Disable loop" });
    expect(loopOn).toHaveAttribute("aria-pressed", "true");

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

describe("the main region's view switcher (#283)", () => {
  const masterTab = () => screen.getByRole("tab", { name: "Master" });
  const arrangementTab = () => screen.getByRole("tab", { name: "Arrangement" });

  async function renderSlice(analytics?: Analytics) {
    repository = inMemoryModule.createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    renderEditor(project.metadata.id, {
      createAuditionEngine: () => fakePreviewEngine(),
      analytics,
    });
    await screen.findByRole("region", { name: "Step editor" });
  }

  it("opens on the arrangement, with both views named and announced", async () => {
    await renderSlice();
    // Both tabs are focusable and activate from the keyboard; the panel is
    // named by whichever tab is selected.
    expect(arrangementTab()).toHaveAttribute("aria-selected", "true");
    expect(masterTab()).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Arrangement" })).toBeInTheDocument();
  });

  it("switches to the master view from the tab", async () => {
    await renderSlice();
    fireEvent.click(masterTab());
    expect(await screen.findByRole("tabpanel", { name: "Master" })).toBeInTheDocument();
    expect(masterTab()).toHaveAttribute("aria-selected", "true");
    // CF-007 step 4: the master's effects are on screen with an empty chain.
    const chain = screen.getByRole("list", { name: "Master chain" });
    expect(within(chain).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("reaches the same state from the mixer's master strip", async () => {
    await renderSlice();
    fireEvent.click(screen.getByRole("button", { name: "Edit Master" }));
    // The second entrypoint lands in exactly the state the tab does.
    expect(await screen.findByRole("tabpanel", { name: "Master" })).toBeInTheDocument();
    expect(masterTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Edit Master" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("logs one main_view_changed per switch, saying how it was reached", async () => {
    const transport = createRecordingTransport();
    await renderSlice(recordingAnalytics(transport));
    fireEvent.click(masterTab());
    await screen.findByRole("tabpanel", { name: "Master" });
    fireEvent.click(arrangementTab());
    await screen.findByRole("tabpanel", { name: "Arrangement" });
    // Switching back takes the master panel off screen with it.
    expect(screen.queryByRole("list", { name: "Master chain" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Master" }));
    await screen.findByRole("tabpanel", { name: "Master" });

    const switches = transport.events.filter((e) => e.name === "main_view_changed");
    expect(switches.map((event) => event.params.view)).toEqual([
      "master",
      "arrangement",
      "master",
    ]);
    expect(switches.map((event) => event.params.via)).toEqual(["tab", "tab", "mixer"]);
  });

  it("logs nothing for re-selecting the view already showing", async () => {
    const transport = createRecordingTransport();
    await renderSlice(recordingAnalytics(transport));
    fireEvent.click(masterTab());
    await screen.findByRole("tabpanel", { name: "Master" });
    fireEvent.click(masterTab());
    fireEvent.click(screen.getByRole("button", { name: "Edit Master" }));
    // Re-selecting is not a change; a view switch is counted once.
    expect(transport.events.filter((e) => e.name === "main_view_changed")).toHaveLength(
      1,
    );
  });

  it("leaves the transport and the playhead alone across a switch", async () => {
    await renderSlice();
    // Audio is owned by `useProjectAudio` above both views, so swapping the
    // view cannot touch the graph, the transport, or the position.
    const playhead = () => document.querySelector(".playhead-position")?.textContent;
    const before = playhead();
    expect(before).toBeTruthy();
    fireEvent.click(masterTab());
    await screen.findByRole("tabpanel", { name: "Master" });
    expect(screen.getByRole("button", { name: "Start playback" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable metronome" })).toBeInTheDocument();
    expect(playhead()).toBe(before);
  });
});
