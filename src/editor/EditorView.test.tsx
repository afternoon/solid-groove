import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installWebAudioGlobals } from "../audio/testAudioContext";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { InMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("../audio/AudioRuntime");
let inMemoryModule: typeof import("../persistence/inMemoryProjectRepository");
let EditorViewModule: typeof import("./EditorView");

beforeAll(async () => {
	AudioRuntimeModule = await import("../audio/AudioRuntime");
	inMemoryModule = await import("../persistence/inMemoryProjectRepository");
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

function renderEditor(projectId: string) {
	const EditorView = EditorViewModule.default;
	return render(() => <EditorView projectId={projectId} />);
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
});
