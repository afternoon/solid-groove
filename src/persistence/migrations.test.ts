import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { stringifyProject } from "../domain/serialize";
import { loadStoredProjectFixture } from "../testing/fixtures";
import { decodeProject, type RawProjectDocuments } from "./documents";
import {
  migrateProjectDocuments,
  PROJECT_MIGRATIONS,
  storedSchemaVersion,
} from "./migrations";

describe("migration harness", () => {
  it("passes a current-schema project through untouched", async () => {
    const stored = await loadStoredProjectFixture("v2-slice-project.json");

    const result = migrateProjectDocuments(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([]);
    expect(result.documents).toBe(stored);
  });

  it("decodes the checked-in current-schema fixture into the fixture project", async () => {
    // This pins the stored wire format: if encoding changes shape, the file on
    // disk stops decoding and the change has to be a deliberate migration.
    const stored = await loadStoredProjectFixture("v2-slice-project.json");

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
    expect(result.applied).toHaveLength(1);

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

  it("refuses a newer schema version without touching it", async () => {
    const stored = await loadStoredProjectFixture("v3-future-project.json");

    const result = migrateProjectDocuments(stored);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("future_version");
    expect(result.storedVersion).toBe(3);
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
