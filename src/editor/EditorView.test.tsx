import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installWebAudioGlobals } from "../audio/testAudioContext";
import { createSliceFixtureProject } from "../domain/fixtures";
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

// EditorView links back to the dashboard with <A>, which needs a matched Route
// context to resolve against — a bare MemoryRouter isn't enough.
function renderEditor(projectId: string) {
	const EditorView = EditorViewModule.default;
	return render(() => (
		<MemoryRouter>
			<Route path="/" component={() => <EditorView projectId={projectId} />} />
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

	it("loads a project and renders its 16-step grid with the saved steps", async () => {
		repository = inMemoryModule.createInMemoryProjectRepository();
		const project = createSliceFixtureProject();
		const created = await repository.createProject(project);
		if (!created.ok) throw new Error("fixture project failed to create");

		renderEditor(project.metadata.id);

		expect(
			await screen.findByRole("group", { name: "16-step sequence" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Step 1, on" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Step 2, off" }),
		).toBeInTheDocument();
		expect(screen.getByText(project.song.tracks[0].name)).toBeInTheDocument();
		// The reopened project reports the pack dependency it saved.
		const dependency = project.metadata.packDependencies[0];
		expect(
			screen.getByText(`Pack: ${dependency.packId} @ ${dependency.version}`),
		).toBeInTheDocument();

		// Undo starts disabled: nothing has been edited yet in this session.
		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
	});

	it("toggling a step enables undo, and undo reverts it", async () => {
		repository = inMemoryModule.createInMemoryProjectRepository();
		const project = createSliceFixtureProject();
		const created = await repository.createProject(project);
		if (!created.ok) throw new Error("fixture project failed to create");

		renderEditor(project.metadata.id);
		await screen.findByRole("group", { name: "16-step sequence" });

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));
		expect(
			await screen.findByRole("button", { name: "Step 2, on" }),
		).toBeInTheDocument();

		const undoButton = await screen.findByRole("button", { name: /^Undo/ });
		expect(undoButton).not.toBeDisabled();
		fireEvent.click(undoButton);

		expect(
			await screen.findByRole("button", { name: "Step 2, off" }),
		).toBeInTheDocument();
	});

	it("autosaves an edit, and the save status settles to Saved with an advanced revision", async () => {
		repository = inMemoryModule.createInMemoryProjectRepository();
		const project = createSliceFixtureProject();
		const created = await repository.createProject(project);
		if (!created.ok) throw new Error("fixture project failed to create");
		const startingRevision = project.metadata.revision;

		renderEditor(project.metadata.id);
		await screen.findByRole("group", { name: "16-step sequence" });

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));

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
		await screen.findByRole("group", { name: "16-step sequence" });

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));
		await screen.findByText("Saved", {}, { timeout: 3_000 });
		const saveStatusEl = document.querySelector(".save-status");
		const revisionAfterAdd = Number(
			saveStatusEl?.getAttribute("data-revision"),
		);

		const undoButton = await screen.findByRole("button", { name: /^Undo/ });
		fireEvent.click(undoButton);
		await screen.findByRole("button", { name: "Step 2, off" });

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
		await screen.findByRole("group", { name: "16-step sequence" });

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));

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
		await screen.findByRole("group", { name: "16-step sequence" });

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

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));

		await screen.findByText("Save failed", {}, { timeout: 3_000 });
		expect(
			screen.getByText("This project changed in another tab or session."),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Retry" }),
		).not.toBeInTheDocument();
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
		await screen.findByRole("group", { name: "16-step sequence" });
		return project;
	}

	it("undoes an edit from the keyboard, through the same command path as the button", async () => {
		await renderSlice();

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));
		await screen.findByRole("button", { name: "Step 2, on" });

		fireEvent.keyDown(window, { key: "z", ctrlKey: true });

		expect(
			await screen.findByRole("button", { name: "Step 2, off" }),
		).toBeInTheDocument();
	});

	it("does nothing when the undo shortcut fires with nothing to undo", async () => {
		await renderSlice();

		// Undo is registered but disabled, so the mapping resolves and stops.
		fireEvent.keyDown(window, { key: "z", ctrlKey: true });

		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Step 1, on" }),
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
});
