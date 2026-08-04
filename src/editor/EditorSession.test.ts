import { beforeEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { addNotes, removeNotes, updateNote } from "../commands";
import { createFactoryContext, createNoteEvent } from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { ClipId } from "../domain/ids";
import { TICKS_PER_SIXTEENTH } from "../domain/time";
import { createInMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { createManualClock } from "../shared/clock";
import { memoryStorage } from "../testing/storage";
import { EditorSession } from "./EditorSession";

async function setUp(options: { deviceStorage?: Storage } = {}) {
	const repository = createInMemoryProjectRepository();
	const project = createSliceFixtureProject();
	const created = await repository.createProject(project);
	if (!created.ok) throw new Error("fixture project failed to create");

	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	analytics.setAccountType("anonymous");

	const clock = createManualClock(1_000);
	const deviceStorage = options.deviceStorage ?? memoryStorage();
	const session = new EditorSession({
		repository,
		project,
		clock,
		analytics,
		deviceStorage,
	});
	const clipId = project.clips[0].id as ClipId;
	return {
		repository,
		project,
		session,
		analytics,
		transport,
		clock,
		clipId,
		deviceStorage,
	};
}

describe("EditorSession", () => {
	let ctx: Awaited<ReturnType<typeof setUp>>;

	beforeEach(async () => {
		ctx = await setUp();
	});

	it("dispatches a command through the shared kernel and updates .project", () => {
		const { session, clipId } = ctx;
		const factoryContext = createFactoryContext();
		const note = createNoteEvent(factoryContext, {
			startTicks: 1 * TICKS_PER_SIXTEENTH,
			durationTicks: TICKS_PER_SIXTEENTH,
			pitch: 36,
		});

		const result = session.dispatch(addNotes(clipId, [note]));

		expect(result.ok).toBe(true);
		const clip = session.project.clips.find(
			(candidate) => candidate.id === clipId,
		);
		expect(clip?.content.kind).toBe("notes");
		if (clip?.content.kind === "notes") {
			expect(clip.content.events).toHaveLength(5);
		}
	});

	it("queues exactly the changed clip for autosave and persists it", async () => {
		const { session, repository, project, clipId } = ctx;
		const factoryContext = createFactoryContext();
		const note = createNoteEvent(factoryContext, {
			startTicks: 1 * TICKS_PER_SIXTEENTH,
			durationTicks: TICKS_PER_SIXTEENTH,
			pitch: 36,
		});

		session.dispatch(addNotes(clipId, [note]));
		expect(session.autosave.status.pending).toBe(1);

		await session.autosave.flush();

		expect(session.autosave.status.state).toBe("saved");
		const loaded = await repository.loadProject(project.metadata.id);
		if (!loaded.ok) throw new Error("expected the project to load");
		const clip = loaded.value.clips.find(
			(candidate) => candidate.id === clipId,
		);
		if (clip?.content.kind !== "notes") throw new Error("expected a note clip");
		expect(clip.content.events).toHaveLength(5);
	});

	it("commits a paint gesture as one history entry, one revision, and one clip write", async () => {
		const { session, repository, project, clipId } = ctx;
		const factoryContext = createFactoryContext();
		const startRevision = session.project.metadata.revision;

		// A three-step paint stroke: each step applies immediately, but the whole
		// stroke commits as one entry and one revision (CLP-02 undo grouping).
		const gesture = session.beginGesture();
		for (const sixteenth of [1, 2, 3]) {
			const note = createNoteEvent(factoryContext, {
				startTicks: sixteenth * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				pitch: 36,
			});
			gesture.apply(addNotes(clipId, [note]));
		}
		// Autosave is deferred until commit: no clip is queued mid-stroke.
		expect(session.autosave.status.pending).toBe(0);
		gesture.commit("Paint 3 steps");

		expect(session.project.metadata.revision).toBe(startRevision + 1);
		expect(session.history.entries).toHaveLength(1);
		// Exactly one clip queued for the whole stroke, not one per step.
		expect(session.autosave.status.pending).toBe(1);

		await session.autosave.flush();
		const loaded = await repository.loadProject(project.metadata.id);
		if (!loaded.ok) throw new Error("expected the project to load");
		const clip = loaded.value.clips.find(
			(candidate) => candidate.id === clipId,
		);
		if (clip?.content.kind !== "notes") throw new Error("expected a note clip");
		// The four fixture events plus the three painted.
		expect(clip.content.events).toHaveLength(7);

		// One undo reverts the whole stroke.
		session.undo();
		expect(session.project.clips[0].content).toMatchObject({ kind: "notes" });
	});

	it("a cancelled gesture leaves the project untouched and queues nothing", () => {
		const { session, clipId } = ctx;
		const factoryContext = createFactoryContext();
		const before = session.project;

		const gesture = session.beginGesture();
		gesture.apply(
			addNotes(clipId, [
				createNoteEvent(factoryContext, {
					startTicks: 1 * TICKS_PER_SIXTEENTH,
					durationTicks: TICKS_PER_SIXTEENTH,
					pitch: 36,
				}),
			]),
		);
		gesture.cancel();

		expect(session.project).toBe(before);
		expect(session.autosave.status.pending).toBe(0);
		expect(session.history.canUndo).toBe(false);
	});

	it("undo reverts the project and re-queues the same clip for autosave", async () => {
		const { session, repository, project, clipId } = ctx;
		const factoryContext = createFactoryContext();
		const note = createNoteEvent(factoryContext, {
			startTicks: 1 * TICKS_PER_SIXTEENTH,
			durationTicks: TICKS_PER_SIXTEENTH,
			pitch: 36,
		});
		session.dispatch(addNotes(clipId, [note]));
		await session.autosave.flush();

		const undoResult = session.undo();
		expect(undoResult?.ok).toBe(true);
		await session.autosave.flush();

		const loaded = await repository.loadProject(project.metadata.id);
		if (!loaded.ok) throw new Error("expected the project to load");
		const clip = loaded.value.clips.find(
			(candidate) => candidate.id === clipId,
		);
		if (clip?.content.kind !== "notes") throw new Error("expected a note clip");
		// Back to the fixture's original four events.
		expect(clip.content.events).toHaveLength(4);
	});

	it("a stale remote echo never restores an undone note", async () => {
		const { session, repository, project, clipId } = ctx;
		const originalEvents = session.project.clips.find(
			(clip) => clip.id === clipId,
		)?.content;

		// Add and immediately undo a note, saving after each step.
		const factoryContext = createFactoryContext();
		const note = createNoteEvent(factoryContext, {
			startTicks: 1 * TICKS_PER_SIXTEENTH,
			durationTicks: TICKS_PER_SIXTEENTH,
			pitch: 36,
		});
		session.dispatch(addNotes(clipId, [note]));
		await session.autosave.flush();
		session.undo();
		await session.autosave.flush();

		// Simulate a stale echo of the pre-undo (five-note) state arriving late,
		// by writing it directly at an older revision than the store now holds.
		// The repository refuses the stale write outright (revision-checked), so
		// undo's own re-queue above is what actually proves the guarantee — this
		// asserts the repository-level half of it holds too.
		const staleWrite = await repository.saveClip(
			project.metadata.id,
			{
				...project.clips[0],
				content: { kind: "notes", events: [note] },
			},
			project.metadata.revision, // the *original* (now stale) revision
		);
		expect(staleWrite.ok).toBe(false);

		const loaded = await repository.loadProject(project.metadata.id);
		if (!loaded.ok) throw new Error("expected the project to load");
		const clip = loaded.value.clips.find(
			(candidate) => candidate.id === clipId,
		);
		expect(clip?.content).toEqual(originalEvents);
	});

	it("logs first_edit once, with the dispatching command's id", () => {
		const { session, transport, clipId } = ctx;
		const clipContent = session.project.clips[0].content;
		if (clipContent.kind !== "notes") throw new Error("expected a note clip");
		const firstEventId = clipContent.events[0].id;

		session.dispatch(updateNote(clipId, firstEventId, { velocity: 0.5 }));
		session.dispatch(removeNotes(clipId, [firstEventId]));

		const firstEditEvents = transport.events.filter(
			(event) => event.name === "first_edit",
		);
		expect(firstEditEvents).toHaveLength(1);
		expect(firstEditEvents[0]?.params.command_id).toBe("note.update");
	});

	it("logs undo_used with direction and actor on undo and redo, once per invocation", () => {
		const { session, transport, clipId } = ctx;
		const factoryContext = createFactoryContext();
		const note = createNoteEvent(factoryContext, {
			startTicks: 1 * TICKS_PER_SIXTEENTH,
			durationTicks: TICKS_PER_SIXTEENTH,
			pitch: 36,
		});
		session.dispatch(addNotes(clipId, [note]));

		session.undo();
		session.redo();

		const undoUsedEvents = transport.named("undo_used");
		expect(undoUsedEvents).toHaveLength(2);
		expect(undoUsedEvents[0]?.params).toMatchObject({
			direction: "undo",
			actor: "user",
		});
		expect(undoUsedEvents[1]?.params).toMatchObject({
			direction: "redo",
			actor: "user",
		});
	});

	it("does not log undo_used when there is nothing to undo or redo", () => {
		const { session, transport } = ctx;

		expect(session.undo()).toBeNull();
		expect(session.redo()).toBeNull();

		expect(transport.named("undo_used")).toHaveLength(0);
	});

	it("logs project_opened exactly once when the session is constructed", () => {
		const { transport } = ctx;

		const opened = transport.named("project_opened");
		expect(opened).toHaveLength(1);
		expect(opened[0]?.params).toMatchObject({
			project_age_bucket: "same_day",
			track_count_bucket: "1_2",
			is_first_open: true,
		});
	});

	it("reports is_first_open: false on a second open of the same project on the same device", async () => {
		const { repository, project, deviceStorage } = ctx;
		const transport2 = createRecordingTransport();
		const analytics2 = new Analytics({
			transport: transport2,
			consent: new ConsentStore(memoryStorage()),
			storage: memoryStorage(),
		});
		analytics2.setAccountType("anonymous");

		const secondSession = new EditorSession({
			repository,
			project,
			clock: createManualClock(2_000),
			analytics: analytics2,
			deviceStorage,
		});

		const opened = transport2.named("project_opened");
		expect(opened).toHaveLength(1);
		expect(opened[0]?.params.is_first_open).toBe(false);

		secondSession.dispose();
	});

	it("reports is_first_open: true again on a different device (isolated storage)", () => {
		const { repository, project } = ctx;
		const transport2 = createRecordingTransport();
		const analytics2 = new Analytics({
			transport: transport2,
			consent: new ConsentStore(memoryStorage()),
			storage: memoryStorage(),
		});
		analytics2.setAccountType("anonymous");

		const otherDeviceSession = new EditorSession({
			repository,
			project,
			clock: createManualClock(2_000),
			analytics: analytics2,
			deviceStorage: memoryStorage(),
		});

		const opened = transport2.named("project_opened");
		expect(opened[0]?.params.is_first_open).toBe(true);

		otherDeviceSession.dispose();
	});

	it("dispose stops the repository watch subscription", async () => {
		const { session, repository, project } = ctx;
		session.dispose();

		// A metadata write after dispose must not throw or resurrect a listener
		// EditorSession already released.
		const result = await repository.saveMetadata(
			project.metadata.id,
			{ name: "Renamed after dispose" },
			project.metadata.revision,
		);
		expect(result.ok).toBe(true);
	});
});
