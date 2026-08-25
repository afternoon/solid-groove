import { beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../domain/entities";
import { createFactoryContext, createPlacement } from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { createManualClock } from "../shared/clock";
import {
  arrangementCollectionPath,
  projectDocumentPath,
  songDocumentPath,
} from "./documents";
import { InMemoryProjectRepository } from "./inMemoryProjectRepository";
import {
  chunkedProject,
  describeProjectRepositoryContract,
} from "./projectRepositoryContract";

// The harness runs before each contract test, so a fresh store per test is
// simply a new instance; there is nothing to tear down. The in-memory store has
// no notion of identity, so every owner shares the one instance.
describeProjectRepositoryContract("in-memory", () => {
  const repository = new InMemoryProjectRepository({
    clock: createManualClock(1_700_000_100_000),
  });
  return { repositoryFor: () => repository, reset: async () => {} };
});

describe("InMemoryProjectRepository", () => {
  let repository: InMemoryProjectRepository;

  beforeEach(() => {
    repository = new InMemoryProjectRepository({
      clock: createManualClock(1_700_000_100_000),
    });
  });

  it("writes one clip document and the metadata revision for a note edit", async () => {
    const project = createSliceFixtureProject();
    await repository.createProject(project);
    repository.clearWrites();

    const clip = project.clips[0];
    const saved = await repository.saveClip(
      project.metadata.id,
      {
        ...clip,
        content:
          clip.content.kind === "notes"
            ? { ...clip.content, events: clip.content.events.slice(0, 2) }
            : clip.content,
      },
      project.metadata.revision,
    );

    expect(saved.ok).toBe(true);
    // The highest-frequency write path touches the clip and the revision only.
    expect(repository.writes.map((write) => write.path)).toEqual([
      `projects/${project.metadata.id}/clips/${clip.id}`,
      `projects/${project.metadata.id}`,
    ]);
  });

  it("does not rewrite the song document when metadata changes", async () => {
    const project = createSliceFixtureProject();
    await repository.createProject(project);
    repository.clearWrites();

    await repository.saveMetadata(
      project.metadata.id,
      { name: "Renamed" },
      project.metadata.revision,
    );

    expect(repository.writes.map((write) => write.path)).toEqual([
      projectDocumentPath(project.metadata.id),
    ]);
  });

  it("stamps the injected clock on writes rather than the wall clock", async () => {
    const clock = createManualClock(1_700_000_100_000);
    const repo = new InMemoryProjectRepository({ clock });
    const project = createSliceFixtureProject();
    await repo.createProject(project);

    clock.advance(5_000);
    const saved = await repo.saveMetadata(
      project.metadata.id,
      { name: "Later" },
      project.metadata.revision,
    );

    expect(saved).toMatchObject({ ok: true, modifiedAt: 1_700_000_105_000 });
  });

  it("removes stale arrangement chunks when the arrangement stops overflowing", async () => {
    const project = chunkedProject();
    await repository.createProject(project);
    expect(
      repository
        .paths()
        .filter((path) =>
          path.startsWith(arrangementCollectionPath(project.metadata.id)),
        ),
    ).not.toHaveLength(0);

    await repository.saveSong(
      project.metadata.id,
      { ...project.song, placements: [] },
      project.metadata.revision,
    );

    expect(
      repository
        .paths()
        .filter((path) =>
          path.startsWith(arrangementCollectionPath(project.metadata.id)),
        ),
    ).toEqual([]);
  });

  it("refuses a write whose per-track chunk cannot fit, leaving state untouched", async () => {
    // One track carrying an arrangement larger than a chunk budget is the case
    // the layout cannot split any further, so it fails loudly instead of
    // writing a document that would eventually hit Firestore's hard limit.
    const project = createSliceFixtureProject();
    await repository.createProject(project);
    const context = createFactoryContext({
      ids: createSeededIdFactory("oversized"),
      now: 1_700_000_100_000,
    });
    const track = project.song.tracks[0];
    const placements = Array.from({ length: 2_000 }, (_, index) =>
      createPlacement(context, {
        clipId: project.clips[0].id,
        trackId: track.id,
        startTicks: index * TICKS_PER_BAR,
        durationTicks: TICKS_PER_BAR,
      }),
    );
    const songBefore = repository.readDocument(songDocumentPath(project.metadata.id));

    const saved = await repository.saveSong(
      project.metadata.id,
      { ...project.song, placements },
      project.metadata.revision,
    );

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.reason).toBe("document_too_large");
    expect(saved.retryable).toBe(false);
    expect(repository.readDocument(songDocumentPath(project.metadata.id))).toEqual(
      songBefore,
    );
    const metadata = await repository.loadProjectMetadata(project.metadata.id);
    expect(metadata.ok).toBe(true);
    if (!metadata.ok) return;
    expect(metadata.value.revision).toBe(project.metadata.revision);
  });

  it("refuses to read a project stored by a newer schema version", async () => {
    const project = createSliceFixtureProject();
    await repository.createProject(project);
    const path = projectDocumentPath(project.metadata.id);
    repository.writeDocument(path, {
      ...repository.readDocument(path),
      schemaVersion: SCHEMA_VERSION + 1,
    });

    const loaded = await repository.loadProject(project.metadata.id);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe("unsupported_schema_version");
  });

  it("refuses to overwrite a project stored by a newer schema version", async () => {
    const project = createSliceFixtureProject();
    await repository.createProject(project);
    const path = projectDocumentPath(project.metadata.id);
    const stored = {
      ...repository.readDocument(path),
      schemaVersion: SCHEMA_VERSION + 1,
    };
    repository.writeDocument(path, stored);

    const saved = await repository.saveMetadata(
      project.metadata.id,
      { name: "Clobbered" },
      project.metadata.revision,
    );

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.reason).toBe("unsupported_schema_version");
    expect(repository.readDocument(path)).toEqual(stored);
  });

  it("skips a malformed document instead of failing the whole dashboard listing", async () => {
    const project = createSliceFixtureProject({ ownerId: "owner-a" });
    await repository.createProject(project);
    repository.writeDocument("projects/prj_broken", {
      ownerId: "owner-a",
      schemaVersion: 1,
    });

    const listed = await repository.listProjects("owner-a");
    expect(listed.map((entry) => entry.id)).toEqual([project.metadata.id]);
  });

  it("reports an injected transient failure as retryable and changes nothing", async () => {
    const project = createSliceFixtureProject();
    await repository.createProject(project);
    repository.failNextWrites({ count: 1 });

    const failed = await repository.saveMetadata(
      project.metadata.id,
      { name: "Nope" },
      project.metadata.revision,
    );
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.reason).toBe("unavailable");
    expect(failed.retryable).toBe(true);

    const retried = await repository.saveMetadata(
      project.metadata.id,
      { name: "Yes" },
      project.metadata.revision,
    );
    expect(retried.ok).toBe(true);
    const loaded = await repository.loadProjectMetadata(project.metadata.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.name).toBe("Yes");
  });
});
