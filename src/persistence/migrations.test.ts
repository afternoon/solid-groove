import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { ProjectId } from "../domain/ids";
import { type JsonObject, stringifyProject } from "../domain/serialize";
import { TICKS_PER_BAR } from "../domain/time";
import { createManualClock } from "../shared/clock";
import { loadStoredProjectFixture } from "../testing/fixtures";
import {
  clipDocumentPath,
  decodeProject,
  projectDocumentPath,
  type RawProjectDocuments,
  songDocumentPath,
} from "./documents";
import { InMemoryProjectRepository } from "./inMemoryProjectRepository";
import {
  decodeStoredProject,
  decodeStoredProjectMetadata,
  migrateProjectDocuments,
  PROJECT_MIGRATIONS,
  storedSchemaVersion,
} from "./migrations";

describe("migration harness", () => {
  it("passes a current-schema project through untouched", async () => {
    const stored = await loadStoredProjectFixture("v4-slice-project.json");

    const result = migrateProjectDocuments(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([]);
    expect(result.documents).toBe(stored);
  });

  it("decodes the checked-in current-schema fixture into the fixture project", async () => {
    // This pins the stored wire format: if encoding changes shape, the file on
    // disk stops decoding and the change has to be a deliberate migration.
    const stored = await loadStoredProjectFixture("v4-slice-project.json");

    const decoded = decodeProject(stored);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(stringifyProject(decoded.value)).toBe(
      stringifyProject(createSliceFixtureProject()),
    );
  });

  it("migrates a schema-v1 project forward into a valid project (LIB-08)", async () => {
    // PRJ-04's fixture convention: the v1 source fixture is stored as it was
    // actually written, and migrating it must produce a project that decodes.
    const stored = await loadStoredProjectFixture("v1-slice-project.json");

    const result = migrateProjectDocuments(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toHaveLength(PROJECT_MIGRATIONS.length);

    const decoded = decodeProject(result.documents);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.metadata.schemaVersion).toBe(SCHEMA_VERSION);
    // A v1 project's shelf is seeded from the packs it already depends on, so a
    // migrated project starts with exactly its used packs shelved.
    expect(decoded.value.metadata.addedPacks).toEqual(
      decoded.value.metadata.packDependencies,
    );
    // The migrated v1 fixture is byte-for-byte the current-schema fixture.
    expect(stringifyProject(decoded.value)).toBe(
      stringifyProject(createSliceFixtureProject()),
    );
  });

  it("opens a v2 project saved before the loop existed with the default loop (LOOP-017)", async () => {
    // The v2 fixture is the slice project exactly as it was stored before
    // `song.loop` was added: no loop field anywhere in the song document.
    const stored = await loadStoredProjectFixture("v2-slice-project.json");
    expect(stored.song).not.toHaveProperty("loop");

    const decoded = decodeStoredProject(stored);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.metadata.schemaVersion).toBe(SCHEMA_VERSION);
    expect(decoded.value.song.loop).toEqual({
      startTicks: 0,
      endTicks: TICKS_PER_BAR,
      enabled: true,
    });
    expect(stringifyProject(decoded.value)).toBe(
      stringifyProject(createSliceFixtureProject()),
    );
  });

  it("migrates a v2 metadata document for the dashboard's metadata-only read", async () => {
    const stored = await loadStoredProjectFixture("v2-slice-project.json");

    const decoded = decodeStoredProjectMetadata(stored.projectId, stored.metadata);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("trims overlapping placements on a track, keeping the earlier one (#290)", async () => {
    const stored = await loadStoredProjectFixture("v3-slice-project.json");
    const song = stored.song as { placements: Record<string, unknown>[] };
    const [kept] = song.placements;
    // Same start as `kept` but later in the array: fully covered, so removed.
    const tied = { ...kept, id: "plc_tiedTiedTiedTiedTiedT" };
    // Starts half a bar into `kept` and runs a bar past it: trimmed to its end.
    const later = {
      ...kept,
      id: "plc_laterLaterLaterLaterL",
      startTicks: 384,
      durationTicks: 1152,
    };
    song.placements.push(tied, later);

    const result = migrateProjectDocuments(stored);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = decodeProject(result.documents);
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.value.song.placements).toEqual([
      kept,
      { ...later, startTicks: 768, durationTicks: 768, clipOffsetTicks: 384 },
    ]);
  });

  it("refuses a newer schema version without touching it", async () => {
    const stored = await loadStoredProjectFixture("v5-future-project.json");

    const result = migrateProjectDocuments(stored);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("future_version");
    expect(result.storedVersion).toBe(SCHEMA_VERSION + 1);
    expect(result.message).toContain("will not read or overwrite it");
  });

  it("reports an older version with no registered migration rather than guessing", () => {
    const stored = {
      projectId: "prj_x",
      metadata: { schemaVersion: 0 },
      song: {},
      clips: [],
    } satisfies RawProjectDocuments;

    const result = migrateProjectDocuments(stored);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown_version");
  });

  it("reports documents that declare no schema version", () => {
    const result = migrateProjectDocuments({
      projectId: "prj_x",
      metadata: { name: "prototype snapshot" },
      song: {},
      clips: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_version");
    expect(
      storedSchemaVersion({
        projectId: "prj_x",
        metadata: null,
        song: {},
        clips: [],
      }),
    ).toBeNull();
  });

  it("registers a gap-free chain up to the current schema version", () => {
    // Empty today: v1 is the first production schema. The assertion is the
    // rule the first post-v1 migration has to keep satisfying.
    let version =
      PROJECT_MIGRATIONS.length > 0 ? PROJECT_MIGRATIONS[0].from : SCHEMA_VERSION;
    for (const migration of PROJECT_MIGRATIONS) {
      expect(migration.from).toBe(version);
      expect(migration.to).toBe(version + 1);
      version = migration.to;
    }
    expect(version).toBe(SCHEMA_VERSION);
  });
});

// Migration is read-time only and autosave writes one tier at a time, so the
// first save of a migrated project leaves every other tier at its stored
// version. Such a project has to keep opening.
describe("a migrated project after its first partial save", () => {
  async function seedStoredProject(fileName: string) {
    const stored = await loadStoredProjectFixture(fileName);
    const projectId = stored.projectId as ProjectId;
    const repository = new InMemoryProjectRepository({
      clock: createManualClock(1_700_000_100_000),
    });
    repository.writeDocument(
      projectDocumentPath(projectId),
      stored.metadata as JsonObject,
    );
    repository.writeDocument(songDocumentPath(projectId), stored.song as JsonObject);
    for (const clip of stored.clips as JsonObject[]) {
      repository.writeDocument(clipDocumentPath(projectId, String(clip.id)), clip);
    }
    const loaded = await repository.loadProject(projectId);
    if (!loaded.ok) throw new Error(`seeded project did not load: ${loaded.message}`);
    return { repository, projectId, project: loaded.value };
  }

  // Every supported older source version, with the version its tiers declare.
  const OLDER_FIXTURES = [
    ["v1-slice-project.json", 1],
    ["v2-slice-project.json", 2],
    ["v3-slice-project.json", 3],
  ] as const;

  it.each(OLDER_FIXTURES)(
    "%s still opens after a song-tier save leaves the clips behind",
    async (fileName, storedVersion) => {
      const { repository, projectId, project } = await seedStoredProject(fileName);

      const saved = await repository.saveSong(
        projectId,
        project.song,
        project.metadata.revision,
      );

      expect(saved.ok).toBe(true);
      const clipPath = clipDocumentPath(projectId, project.clips[0].id);
      expect(repository.readDocument(clipPath)?.schemaVersion).toBe(storedVersion);
      const reloaded = await repository.loadProject(projectId);
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok) return;
      expect(reloaded.value.song.loop).toEqual(project.song.loop);
    },
  );

  it.each(OLDER_FIXTURES)(
    "%s still opens after a clip-tier save leaves the song behind",
    async (fileName, storedVersion) => {
      const { repository, projectId, project } = await seedStoredProject(fileName);

      const saved = await repository.saveClip(
        projectId,
        project.clips[0],
        project.metadata.revision,
      );

      expect(saved.ok).toBe(true);
      const song = repository.readDocument(songDocumentPath(projectId));
      expect(song?.schemaVersion).toBe(storedVersion);
      const reloaded = await repository.loadProject(projectId);
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok) return;
      expect(reloaded.value.metadata.schemaVersion).toBe(SCHEMA_VERSION);
      // The song tier is still at its stored version, so the loop is migrated in again.
      expect(reloaded.value.song.loop).toEqual(project.song.loop);
    },
  );

  it("refuses a child document from a newer schema under current metadata", async () => {
    const stored = await loadStoredProjectFixture("v1-slice-project.json");
    const clip = (stored.clips as JsonObject[])[0];

    const decoded = decodeStoredProject({
      ...stored,
      clips: [{ ...clip, schemaVersion: SCHEMA_VERSION + 1 }],
    });

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues[0]).toMatchObject({
      code: "unsupported_schema_version",
      path: ["clips", 0, "schemaVersion"],
    });
  });
});
