import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createManualClock } from "../shared/clock";
import {
	createManualScheduler,
	type ManualScheduler,
} from "../shared/scheduler";
import { ProjectAutosave, type SaveStatus } from "./autosave";
import { clipDocumentPath, songDocumentPath } from "./documents";
import { InMemoryProjectRepository } from "./inMemoryProjectRepository";
import type { ProjectRepository } from "./projectRepository";

/**
 * Wraps a repository so the first `saveSong` blocks until the test releases it.
 * It stands in for network latency: the value handed to the repository is the
 * one captured when the write started, so an edit made during the await is a
 * genuinely newer value that must still reach the store.
 */
function gateFirstSongSave(inner: ProjectRepository): {
	repository: ProjectRepository;
	release: () => void;
} {
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let gated = true;
	const repository: ProjectRepository = {
		createProject: (project) => inner.createProject(project),
		loadProject: (projectId) => inner.loadProject(projectId),
		listProjects: (ownerId) => inner.listProjects(ownerId),
		loadProjectMetadata: (projectId) => inner.loadProjectMetadata(projectId),
		saveMetadata: (projectId, patch, base) =>
			inner.saveMetadata(projectId, patch, base),
		saveSong: async (projectId, song, base) => {
			if (gated) {
				gated = false;
				await gate;
			}
			return inner.saveSong(projectId, song, base);
		},
		saveClip: (projectId, clip, base) => inner.saveClip(projectId, clip, base),
		deleteClip: (projectId, clipId, base) =>
			inner.deleteClip(projectId, clipId, base),
		deleteProject: (projectId) => inner.deleteProject(projectId),
		watchProject: (projectId, listener) =>
			inner.watchProject(projectId, listener),
	};
	return { repository, release: () => release() };
}

describe("ProjectAutosave", () => {
	let repository: InMemoryProjectRepository;
	let scheduler: ManualScheduler;
	let project: Project;
	let autosave: ProjectAutosave;
	let statuses: SaveStatus[];

	beforeEach(async () => {
		repository = new InMemoryProjectRepository({
			clock: createManualClock(1_700_000_100_000),
		});
		scheduler = createManualScheduler();
		project = createSliceFixtureProject();
		await repository.createProject(project);
		repository.clearWrites();
		statuses = [];
		autosave = new ProjectAutosave({
			repository,
			projectId: project.metadata.id,
			revision: project.metadata.revision,
			coalesceMs: 400,
			scheduler,
			onStatus: (status) => statuses.push(status),
		});
	});

	function renamedSong(tempo: number) {
		return { ...project.song, tempo };
	}

	it("starts idle and reports pending work as soon as an edit is queued", () => {
		expect(autosave.status.state).toBe("idle");

		autosave.queueSong(renamedSong(121));

		expect(autosave.status).toMatchObject({ state: "pending", pending: 1 });
	});

	it("coalesces rapid edits to the same entity into one write", async () => {
		for (let tempo = 121; tempo <= 140; tempo += 1) {
			autosave.queueSong(renamedSong(tempo));
		}
		expect(repository.writes).toHaveLength(0);

		scheduler.runAll();
		await autosave.flush();

		expect(
			repository.writes.filter(
				(write) => write.path === songDocumentPath(project.metadata.id),
			),
		).toHaveLength(1);
		const loaded = await repository.loadProject(project.metadata.id);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		// The final value survives coalescing — only the intermediate ones are lost.
		expect(loaded.value.song.tempo).toBe(140);
	});

	it("keeps an edit made while a write is in flight instead of dropping it", async () => {
		const { repository: gated, release } = gateFirstSongSave(repository);
		const songPath = songDocumentPath(project.metadata.id);
		// Sampled whenever a status is published, so a "saved" that was announced
		// before the final value reached the store is visible to the assertions.
		const savedWith: Array<number | undefined> = [];
		const controller = new ProjectAutosave({
			repository: gated,
			projectId: project.metadata.id,
			revision: project.metadata.revision,
			coalesceMs: 400,
			scheduler,
			onStatus: (status) => {
				if (status.state === "saved") {
					savedWith.push(repository.readDocument(songPath)?.tempo as number);
				}
			},
		});

		controller.queueSong(renamedSong(121));
		const firstFlush = controller.flush();
		// Let drain() reach the awaited write before the next edit arrives.
		await Promise.resolve();
		controller.queueSong(renamedSong(140));
		release();
		await firstFlush;
		scheduler.runAll();
		await controller.flush();

		const loaded = await repository.loadProject(project.metadata.id);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.value.song.tempo).toBe(140);
		expect(controller.status).toMatchObject({ state: "saved", pending: 0 });
		// Every "saved" the UI could have shown was backed by the final value.
		expect(savedWith.length).toBeGreaterThan(0);
		expect(savedWith).toEqual(savedWith.map(() => 140));
	});

	it("writes each edited entity once, in the order the edits were made", async () => {
		autosave.queueMetadata({ name: "Renamed" });
		autosave.queueClip(project.clips[0]);
		autosave.queueSong(renamedSong(126));

		await autosave.flush();

		expect(repository.writes.map((write) => write.path)).toEqual([
			`projects/${project.metadata.id}`,
			clipDocumentPath(project.metadata.id, project.clips[0].id),
			`projects/${project.metadata.id}`,
			songDocumentPath(project.metadata.id),
			`projects/${project.metadata.id}`,
		]);
		expect(autosave.status).toMatchObject({
			state: "saved",
			pending: 0,
			revision: project.metadata.revision + 3,
		});
	});

	it("merges successive metadata patches instead of overwriting them", async () => {
		autosave.queueMetadata({ name: "First" });
		autosave.queueMetadata({ genre: "house" });

		await autosave.flush();

		const loaded = await repository.loadProjectMetadata(project.metadata.id);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.value).toMatchObject({ name: "First", genre: "house" });
	});

	it("exposes saving and saved states around a write", async () => {
		autosave.queueSong(renamedSong(122));
		await autosave.flush();

		expect(statuses.map((status) => status.state)).toEqual([
			"pending",
			"saving",
			"saved",
		]);
	});

	it("writes automatically once the coalescing window elapses", async () => {
		autosave.queueSong(renamedSong(123));

		scheduler.advance(399);
		expect(repository.writes).toHaveLength(0);
		scheduler.advance(1);
		await autosave.flush();

		expect(repository.writes.length).toBeGreaterThan(0);
	});

	it("keeps a failed write queued and retries it with the same value", async () => {
		repository.failNextWrites({ count: 1 });
		autosave.queueSong(renamedSong(124));

		await autosave.flush();

		expect(autosave.status).toMatchObject({ state: "failed", pending: 1 });
		expect(autosave.status.failure?.retryable).toBe(true);

		await autosave.retry();

		expect(autosave.status).toMatchObject({ state: "saved", pending: 0 });
		const loaded = await repository.loadProject(project.metadata.id);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.value.song.tempo).toBe(124);
	});

	it("stops at the failing write rather than burning revisions on later ones", async () => {
		repository.failNextWrites({ count: 1 });
		autosave.queueSong(renamedSong(125));
		autosave.queueClip(project.clips[0]);

		await autosave.flush();

		expect(autosave.status).toMatchObject({ state: "failed", pending: 2 });
	});

	it("surfaces a revision conflict instead of silently retrying forever", async () => {
		// Another client writes first, so the local base revision is stale.
		await repository.saveMetadata(
			project.metadata.id,
			{ name: "Other client" },
			project.metadata.revision,
		);

		autosave.queueSong(renamedSong(127));
		await autosave.flush();

		expect(autosave.status.state).toBe("failed");
		expect(autosave.status.failure).toMatchObject({
			reason: "revision_conflict",
			retryable: false,
			currentRevision: project.metadata.revision + 1,
		});
	});

	it("ignores a remote echo of its own write", async () => {
		autosave.queueMetadata({ name: "Local" });
		await autosave.flush();
		const localRevision = autosave.status.revision;

		const echo = await repository.loadProjectMetadata(project.metadata.id);
		expect(echo.ok).toBe(true);
		if (!echo.ok) return;

		expect(
			autosave.applyRemote({ kind: "metadata", metadata: echo.value }),
		).toBe("ignored_stale");
		expect(autosave.status.revision).toBe(localRevision);
	});

	it("ignores a newer remote snapshot while a local edit is still queued", async () => {
		autosave.queueSong(renamedSong(128));

		const remote = await repository.loadProjectMetadata(project.metadata.id);
		expect(remote.ok).toBe(true);
		if (!remote.ok) return;

		expect(
			autosave.applyRemote({
				kind: "metadata",
				metadata: { ...remote.value, revision: 99 },
			}),
		).toBe("ignored_local_pending");
	});

	it("adopts a newer remote snapshot when nothing is queued locally", async () => {
		const adopted: number[] = [];
		const controller = new ProjectAutosave({
			repository,
			projectId: project.metadata.id,
			revision: project.metadata.revision,
			scheduler,
			onRemoteMetadata: (metadata) => adopted.push(metadata.revision),
		});

		const remote = await repository.loadProjectMetadata(project.metadata.id);
		expect(remote.ok).toBe(true);
		if (!remote.ok) return;

		expect(
			controller.applyRemote({
				kind: "metadata",
				metadata: { ...remote.value, revision: 4 },
			}),
		).toBe("adopted");
		expect(controller.status.revision).toBe(4);
		expect(adopted).toEqual([4]);
	});

	it("stops writing after disposal and cancels the pending timer", async () => {
		autosave.queueSong(renamedSong(129));
		autosave.dispose();

		scheduler.runAll();
		await autosave.flush();

		expect(scheduler.pending).toBe(0);
		expect(repository.writes).toHaveLength(0);
	});
});
