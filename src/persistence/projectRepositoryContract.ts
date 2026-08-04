import { beforeEach, describe, expect, it } from "vitest";
import {
	type Clip,
	type Pack,
	type Project,
	packVersion,
	type Song,
} from "../domain/entities";
import { createFactoryContext, createNoteEvent } from "../domain/factories";
import {
	createDrumMachineFixtureProject,
	createReferenceProject,
	createSliceFixtureProject,
	drumMachineFixturePacks,
} from "../domain/fixtures";
import type { ClipId } from "../domain/ids";
import { createSeededIdFactory } from "../domain/ids";
import { derivePackDependencies } from "../domain/packs";
import { serializeClip, stringifyProject } from "../domain/serialize";
import { TICKS_PER_SIXTEENTH } from "../domain/time";
import type { ProjectRepository } from "./projectRepository";

/**
 * The repository contract suite.
 *
 * Both the in-memory and the Firestore repositories run these tests, so the
 * fake cannot quietly diverge from the backend it stands in for. Anything a
 * caller is allowed to rely on belongs here; anything specific to one
 * implementation (write logging, security rules) belongs in that
 * implementation's own suite.
 */

/** The owner the fixture projects belong to, and a second, unrelated user. */
export const CONTRACT_OWNER = "user_fixture";
export const CONTRACT_OTHER_OWNER = "user_other";

export interface ContractHarness {
	/**
	 * A repository acting as `ownerId`. A store with no notion of identity
	 * returns the same instance; the Firestore store returns one authenticated
	 * as that user, so the contract runs through the real security rules.
	 */
	repositoryFor(ownerId: string): ProjectRepository;
	/** Called before each test to reset stored state. */
	reset(): Promise<void>;
}

export function describeProjectRepositoryContract(
	label: string,
	createHarness: () => Promise<ContractHarness> | ContractHarness,
): void {
	describe(`${label}: ProjectRepository contract`, () => {
		let harness: ContractHarness;
		let repository: ProjectRepository;

		beforeEach(async () => {
			harness = await createHarness();
			repository = harness.repositoryFor(CONTRACT_OWNER);
			await harness.reset();
		});

		async function store(project: Project): Promise<Project> {
			const created = await repository.createProject(project);
			if (!created.ok) {
				throw new Error(
					`createProject failed: ${created.reason} — ${created.message}`,
				);
			}
			return project;
		}

		it("round trips a created project through the three tiers", async () => {
			const project = await store(createSliceFixtureProject());

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(stringifyProject(loaded.value)).toBe(stringifyProject(project));
		});

		it("round trips a project whose arrangement overflows into chunks", async () => {
			const project = await store(chunkedProject());

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(loaded.value.song.placements).toHaveLength(
				project.song.placements.length,
			);
			expect(stringifyProject(loaded.value)).toBe(stringifyProject(project));
		});

		it("reports a missing project as not found", async () => {
			const missing = createSliceFixtureProject({ seed: "missing" });
			const loaded = await repository.loadProject(missing.metadata.id);
			expect(loaded.ok).toBe(false);
			if (loaded.ok) return;
			expect(loaded.reason).toBe("not_found");
		});

		it("refuses to create the same project twice", async () => {
			const project = await store(createSliceFixtureProject());

			const again = await repository.createProject(project);
			expect(again.ok).toBe(false);
			if (again.ok) return;
			expect(again.reason).toBe("already_exists");
		});

		it("lists project metadata for one owner without loading song or clips", async () => {
			const mine = await store(
				createSliceFixtureProject({ ownerId: CONTRACT_OWNER, seed: "mine" }),
			);
			const theirs = await harness
				.repositoryFor(CONTRACT_OTHER_OWNER)
				.createProject(
					createSliceFixtureProject({
						ownerId: CONTRACT_OTHER_OWNER,
						seed: "theirs",
					}),
				);
			expect(theirs.ok).toBe(true);

			const listed = await repository.listProjects(CONTRACT_OWNER);
			expect(listed.map((entry) => entry.id)).toEqual([mine.metadata.id]);
			expect(listed[0].name).toBe(mine.metadata.name);
			// A summary is metadata only: it carries no song or clip state at all.
			expect(listed[0]).not.toHaveProperty("song");
			expect(listed[0]).not.toHaveProperty("clips");
		});

		it("returns an empty list before the owner has any projects", async () => {
			expect(await repository.listProjects(CONTRACT_OWNER)).toEqual([]);
		});

		it("saves a clip and bumps the project revision", async () => {
			const project = await store(createSliceFixtureProject());
			const clip = withExtraNote(project.clips[0]);

			const saved = await repository.saveClip(
				project.metadata.id,
				clip,
				project.metadata.revision,
			);
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			expect(saved.revision).toBe(project.metadata.revision + 1);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(serializeClip(loaded.value.clips[0])).toEqual(serializeClip(clip));
			expect(loaded.value.metadata.revision).toBe(saved.revision);
		});

		it("rejects a write made against a stale revision without changing state", async () => {
			const project = await store(createSliceFixtureProject());
			const newer = withExtraNote(project.clips[0]);
			const first = await repository.saveClip(
				project.metadata.id,
				newer,
				project.metadata.revision,
			);
			expect(first.ok).toBe(true);

			const stale = await repository.saveClip(
				project.metadata.id,
				project.clips[0],
				project.metadata.revision,
			);
			expect(stale.ok).toBe(false);
			if (stale.ok) return;
			expect(stale.reason).toBe("revision_conflict");
			expect(stale.currentRevision).toBe(project.metadata.revision + 1);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			// The stale write left the newer clip in place.
			expect(serializeClip(loaded.value.clips[0])).toEqual(
				serializeClip(newer),
			);
			expect(loaded.value.metadata.revision).toBe(
				project.metadata.revision + 1,
			);
		});

		it("saves song structure and metadata independently", async () => {
			const project = await store(createSliceFixtureProject());

			const renamed = await repository.saveMetadata(
				project.metadata.id,
				{ name: "Renamed", genre: "house" },
				project.metadata.revision,
			);
			expect(renamed.ok).toBe(true);
			if (!renamed.ok) return;

			const retempo = await repository.saveSong(
				project.metadata.id,
				{ ...project.song, tempo: 128 },
				renamed.revision,
			);
			expect(retempo.ok).toBe(true);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(loaded.value.metadata.name).toBe("Renamed");
			expect(loaded.value.metadata.genre).toBe("house");
			expect(loaded.value.song.tempo).toBe(128);
		});

		it("drops arrangement chunks when the arrangement shrinks below the budget", async () => {
			const project = await store(chunkedProject());

			const trimmed = await repository.saveSong(
				project.metadata.id,
				{ ...project.song, placements: project.song.placements.slice(0, 4) },
				project.metadata.revision,
			);
			expect(trimmed.ok).toBe(true);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(loaded.value.song.placements).toHaveLength(4);
		});

		it("deletes a clip and the placement that referenced it", async () => {
			const project = await store(createSliceFixtureProject());
			const doomed = project.clips[0];

			// The placement goes first: an arrangement referencing a deleted clip is
			// not valid schema-v1 state, so the store is never left holding one.
			const song = await repository.saveSong(
				project.metadata.id,
				{ ...project.song, placements: [] },
				project.metadata.revision,
			);
			expect(song.ok).toBe(true);
			if (!song.ok) return;

			const deleted = await repository.deleteClip(
				project.metadata.id,
				doomed.id,
				song.revision,
			);
			expect(deleted.ok).toBe(true);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(loaded.value.clips).toEqual([]);
		});

		it("deletes every document of a project", async () => {
			const project = await store(chunkedProject());

			await repository.deleteProject(project.metadata.id);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(false);
			if (loaded.ok) return;
			expect(loaded.reason).toBe("not_found");
			expect(await repository.listProjects(project.metadata.ownerId)).toEqual(
				[],
			);
		});

		it("reports not found when writing to a project that does not exist", async () => {
			const project = createSliceFixtureProject({ seed: "absent" });
			const result = await repository.saveClip(
				project.metadata.id,
				project.clips[0],
				0,
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("not_found");
		});

		it("exposes the pack dependency list on the metadata tier alone", async () => {
			const project = await store(createDrumMachineFixtureProject());

			// The dashboard read: metadata only, and it already answers "which packs
			// does this project need?" without touching song or clip documents.
			const listed = await repository.listProjects(CONTRACT_OWNER);
			expect(listed).toHaveLength(1);
			expect(listed[0].packDependencies).toEqual(
				project.metadata.packDependencies,
			);
			expect(listed[0].packDependencies).toHaveLength(2);

			const metadata = await repository.loadProjectMetadata(
				project.metadata.id,
			);
			expect(metadata.ok).toBe(true);
			if (!metadata.ok) return;
			expect(metadata.value.packDependencies).toEqual(
				project.metadata.packDependencies,
			);
		});

		it("recomputes the dependency list from the song it is saving", async () => {
			const project = await store(createDrumMachineFixtureProject());
			const loopPackId = loopPack(project).id;
			const { song, clipId } = songWithoutLoopPack(project);

			// Removing a pack's last asset is three independent tier writes, in the
			// order the invariants allow: unplace it, drop its clip, then drop the
			// asset. Only the last one changes which packs the project needs.
			const unplaced = await repository.saveSong(
				project.metadata.id,
				{ ...project.song, placements: song.placements },
				project.metadata.revision,
			);
			expect(unplaced.ok).toBe(true);
			if (!unplaced.ok) return;
			const declaredMidway = await repository.loadProjectMetadata(
				project.metadata.id,
			);
			expect(declaredMidway.ok).toBe(true);
			if (!declaredMidway.ok) return;
			// The asset is still there, so the pack is still a dependency.
			expect(declaredMidway.value.packDependencies).toHaveLength(2);

			const removedClip = await repository.deleteClip(
				project.metadata.id,
				clipId,
				unplaced.revision,
			);
			expect(removedClip.ok).toBe(true);
			if (!removedClip.ok) return;

			const saved = await repository.saveSong(
				project.metadata.id,
				song,
				removedClip.revision,
			);
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;

			// One revision-checked write: the song tier and the derived list on the
			// metadata tier moved together, so no reader sees them disagree.
			const metadata = await repository.loadProjectMetadata(
				project.metadata.id,
			);
			expect(metadata.ok).toBe(true);
			if (!metadata.ok) return;
			expect(metadata.value.revision).toBe(saved.revision);
			expect(
				metadata.value.packDependencies.map((entry) => entry.packId),
			).not.toContain(loopPackId);
			expect(metadata.value.packDependencies).toHaveLength(1);

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok, `issues: ${JSON.stringify(loaded)}`).toBe(true);
			if (!loaded.ok) return;
			expect(loaded.value.metadata.packDependencies).toEqual(
				derivePackDependencies(loaded.value.song),
			);
		});

		it("leaves the dependency list alone when only metadata changes", async () => {
			const project = await store(createDrumMachineFixtureProject());

			const renamed = await repository.saveMetadata(
				project.metadata.id,
				{ name: "Renamed", collaboratorIds: ["user_second"] },
				project.metadata.revision,
			);
			expect(renamed.ok).toBe(true);

			const metadata = await repository.loadProjectMetadata(
				project.metadata.id,
			);
			expect(metadata.ok).toBe(true);
			if (!metadata.ok) return;
			expect(metadata.value.packDependencies).toEqual(
				project.metadata.packDependencies,
			);
		});

		it("persists an added-but-unused pack on the shelf across a reload (LIB-08)", async () => {
			const project = await store(createDrumMachineFixtureProject());
			const shelfOnly = {
				packId: createSeededIdFactory("contract-shelf")("pack"),
				version: packVersion("1.0.0"),
			};

			// Adding a pack the project uses no asset from touches only the metadata
			// tier — the shelf is maintained, not derived.
			const saved = await repository.saveMetadata(
				project.metadata.id,
				{ addedPacks: [...project.metadata.addedPacks, shelfOnly] },
				project.metadata.revision,
			);
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;

			// Reloading — the "reopen on another device" path — still shows the pack.
			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(loaded.value.metadata.addedPacks).toContainEqual(shelfOnly);
			// It is on the shelf but not a dependency: no asset resolves from it.
			expect(loaded.value.metadata.packDependencies).not.toContainEqual(
				shelfOnly,
			);

			// The dashboard read shows it too, from the metadata tier alone.
			const metadata = await repository.loadProjectMetadata(
				project.metadata.id,
			);
			expect(metadata.ok).toBe(true);
			if (!metadata.ok) return;
			expect(metadata.value.addedPacks).toContainEqual(shelfOnly);
		});

		it("round trips a two-pack project's asset pack qualification", async () => {
			const project = await store(createDrumMachineFixtureProject());

			const loaded = await repository.loadProject(project.metadata.id);
			expect(loaded.ok).toBe(true);
			if (!loaded.ok) return;
			expect(
				loaded.value.song.assets.map((asset) => [
					asset.packId,
					asset.packVersion,
				]),
			).toEqual(
				project.song.assets.map((asset) => [asset.packId, asset.packVersion]),
			);
			expect(
				new Set(loaded.value.song.assets.map((asset) => asset.packId)).size,
			).toBe(2);
		});

		it("notifies a watcher of metadata changes and stops after unsubscribe", async () => {
			const project = await store(createSliceFixtureProject());
			const seen: number[] = [];
			const unsubscribe = repository.watchProject(
				project.metadata.id,
				(event) => {
					if (event.kind === "metadata") {
						seen.push(event.metadata.revision);
					}
				},
			);

			const saved = await repository.saveMetadata(
				project.metadata.id,
				{ name: "Watched" },
				project.metadata.revision,
			);
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			await waitFor(() => seen.includes(saved.revision));

			unsubscribe();
			const before = seen.length;
			await repository.saveMetadata(
				project.metadata.id,
				{ name: "Unwatched" },
				saved.revision,
			);
			await settle();
			expect(seen.length).toBe(before);
		});
	});
}

/**
 * A project whose arrangement is large enough to overflow the song-document
 * budget, spread over enough tracks that each per-track chunk still fits.
 */
export function chunkedProject(): Project {
	return createReferenceProject({
		seed: "chunked-fixture",
		trackCount: 12,
		minutes: 10,
		placementCount: 1_800,
		automationLaneCount: 12,
	});
}

/** The drum-machine fixture's loop pack — the second of its two packs. */
function loopPack(project: Project): Pack {
	const pack = drumMachineFixturePacks().loops;
	if (!project.song.assets.some((asset) => asset.packId === pack.id)) {
		throw new Error("fixture no longer draws from the loop pack");
	}
	return pack;
}

/**
 * The fixture's song with the loop pack's asset, and the placement of the clip
 * that used it, removed — the state a "remove this loop" command would produce,
 * and the state that drops the project's second pack dependency. Also returns
 * the clip that has to be deleted from the clip tier.
 */
function songWithoutLoopPack(project: Project): { song: Song; clipId: ClipId } {
	const packId = loopPack(project).id;
	const droppedAssetIds = new Set(
		project.song.assets
			.filter((asset) => asset.packId === packId)
			.map((asset) => asset.id),
	);
	const clip = project.clips.find(
		(candidate) =>
			candidate.content.kind === "audioLoop" &&
			droppedAssetIds.has(candidate.content.assetId),
	);
	if (!clip) {
		throw new Error("fixture has no clip using the loop pack");
	}
	return {
		clipId: clip.id,
		song: {
			...project.song,
			assets: project.song.assets.filter((asset) => asset.packId !== packId),
			placements: project.song.placements.filter(
				(placement) => placement.clipId !== clip.id,
			),
		},
	};
}

function withExtraNote(clip: Clip): Clip {
	if (clip.content.kind !== "notes") return clip;
	const context = createFactoryContext({
		ids: createSeededIdFactory("contract-note"),
		now: 1_700_000_000_000,
	});
	return {
		...clip,
		content: {
			...clip.content,
			events: [
				...clip.content.events,
				createNoteEvent(context, {
					startTicks: TICKS_PER_SIXTEENTH * 2,
					durationTicks: TICKS_PER_SIXTEENTH,
					pitch: 38,
				}),
			],
		},
	};
}

/** Polls until `predicate` holds, so listener-based assertions are not flaky. */
async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error("Timed out waiting for a repository notification");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Gives an asynchronous listener a chance to fire before asserting it did not. */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 50));
}
