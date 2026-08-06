import { MemoryRouter, Route } from "@solidjs/router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installWebAudioGlobals } from "../audio/testAudioContext";
import {
	createDrumMachineFixtureProject,
	createPianoRollFixtureProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import { fakePreviewEngine } from "../library/__fixtures__/fakePreviewEngine";
import type { PreviewEngine } from "../library/audition";
import type { InMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { detectPlatform, shortcutLabel } from "../shortcuts";

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

// EditorView links back to the dashboard with <A>, which needs a matched Route
// context to resolve against — a bare MemoryRouter isn't enough.
function renderEditor(
	projectId: string,
	options: { createAuditionEngine?: () => PreviewEngine } = {},
) {
	const EditorView = EditorViewModule.default;
	return render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<EditorView
						projectId={projectId}
						createAuditionEngine={options.createAuditionEngine}
					/>
				)}
			/>
		</MemoryRouter>
	));
}

describe("EditorView", () => {
	it("shows a loading state, then the 404 page for a project that does not exist", async () => {
		repository = inMemoryModule.createInMemoryProjectRepository();

		renderEditor("prj_doesnotexist00000000");

		expect(screen.getByText("Loading project")).toBeInTheDocument();
		expect(
			await screen.findByText("This groove is broken"),
		).toBeInTheDocument();
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
		expect(
			screen.getByRole("button", { name: "Notes, step 1, on" }),
		).toBeInTheDocument();
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
		expect(
			await screen.findByRole("region", { name: "Audio loop" }),
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

		expect(
			await screen.findByRole("region", { name: /Piano roll/ }),
		).toBeInTheDocument();
		// The step editor is a two-dimensional pitch editor's poor fit, so a
		// synth note clip shows the piano roll instead.
		expect(
			screen.queryByRole("region", { name: "Step editor" }),
		).not.toBeInTheDocument();
	});

	it("shows the sampler instrument panel for the slice's sampler track", async () => {
		repository = inMemoryModule.createInMemoryProjectRepository();
		const project = createSliceFixtureProject();
		const created = await repository.createProject(project);
		if (!created.ok) throw new Error("fixture project failed to create");

		renderEditor(project.metadata.id);

		expect(
			await screen.findByRole("region", { name: "Sampler" }),
		).toBeInTheDocument();
		// The INS-01 sampler controls: pitch, sample start/end, amp envelope.
		expect(screen.getByLabelText("Pitch")).toBeInTheDocument();
		expect(screen.getByLabelText("Start")).toBeInTheDocument();
		expect(screen.getByLabelText("End")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Audition" }),
		).toBeInTheDocument();
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
		const revisionAfterAdd = Number(
			saveStatusEl?.getAttribute("data-revision"),
		);

		const undoButton = await screen.findByRole("button", { name: /^Undo/ });
		fireEvent.click(undoButton);
		await screen.findByRole("button", { name: "Notes, step 2, off" });

		await vi.waitFor(() => {
			const revisionAfterUndo = Number(
				saveStatusEl?.getAttribute("data-revision"),
			);
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
		expect(screen.getByText("Check your connection.")).toBeInTheDocument();
		const retryButton = await screen.findByRole("button", { name: "Retry" });

		fireEvent.click(retryButton);

		await screen.findByText("Saved", {}, { timeout: 3_000 });
		expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Retry" }),
		).not.toBeInTheDocument();

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
		expect(
			screen.queryByRole("button", { name: "Retry" }),
		).not.toBeInTheDocument();
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

		// First open builds one engine.
		toggleLibrary();
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
		// session.
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
		expect(
			screen.getByRole("button", { name: "Notes, step 1, on" }),
		).toBeInTheDocument();
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
		expect(document.activeElement).toBe(
			screen.getByLabelText("Search shortcuts"),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		await vi.waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
		);
		expect(document.activeElement).toBe(opener);
	});

	it("does not toggle playback while the guide is open", async () => {
		await renderSlice();

		fireEvent.keyDown(window, { key: "?", shiftKey: true });
		await screen.findByRole("dialog");

		fireEvent.keyDown(window, { key: " " });

		// The transport button still offers Play, so Space never reached it.
		expect(
			screen.getByRole("button", { name: "Start playback" }),
		).toBeInTheDocument();
	});

	it("does not toggle playback while the pack browser is open, and Escape closes it", async () => {
		await renderSlice();

		// The pack browser is a modal surface like the guide, so it takes the
		// keyboard the same way (PRD KEY-02).
		fireEvent.click(screen.getByRole("button", { name: "Library" }));
		fireEvent.click(
			await screen.findByRole("button", { name: /Browse packs/ }),
		);
		await screen.findByRole("dialog");

		fireEvent.keyDown(window, { key: " " });
		expect(
			screen.getByRole("button", { name: "Start playback" }),
		).toBeInTheDocument();

		fireEvent.keyDown(window, { key: "Escape" });
		await vi.waitFor(() =>
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
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
		expect(
			screen.getByRole("button", { name: "Start playback" }),
		).toHaveAttribute("title", "Play (Space)");
		expect(
			screen.getByRole("button", { name: "Keyboard shortcuts" }),
		).toHaveAttribute("title", "Keyboard shortcuts (?)");
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
		expect(
			screen.getByTitle("Time signature (fixed at 4/4)"),
		).toHaveTextContent("Time signature 4/4");
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
		expect(
			screen.getByRole("button", { name: "Enable metronome" }),
		).toBeInTheDocument();

		fireEvent.keyDown(window, { key: "o" });

		expect(
			await screen.findByRole("button", { name: "Disable metronome" }),
		).toBeInTheDocument();
	});
});
