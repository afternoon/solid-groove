import { type Project, type ProjectMetadata, SCHEMA_VERSION } from "../domain/entities";
import {
  type DecodeResult,
  decodeProject,
  decodeProjectMetadata,
  type RawProjectDocuments,
} from "./documents";

/**
 * The metadata half of the v1 -> v2 migration (LIB-08), shared by the
 * full-project path and the dashboard's metadata-only path so both seed the
 * shelf identically.
 *
 * A v1 project has no shelf field. Its shelf is seeded from the packs it already
 * depends on — `metadata.packDependencies`, which v1 stored — so a migrated
 * project starts with exactly the packs it uses on the shelf and none it does
 * not. This satisfies the domain invariant (every used pack is shelved) on the
 * first read, before any `pack.add`/`pack.remove` runs.
 */
function metadataV1ToV2(metadata: Record<string, unknown>): Record<string, unknown> {
  const dependencies = Array.isArray(metadata.packDependencies)
    ? metadata.packDependencies
    : [];
  return {
    ...metadata,
    schemaVersion: 2,
    // The shelf a v1 project starts with is exactly what it already uses.
    addedPacks: dependencies.map((dependency) => ({ ...asRecord(dependency) })),
  };
}

/**
 * v1 -> v2 (LIB-08): the project gains a pack shelf, `metadata.addedPacks`.
 *
 * Every stored tier carries a `schemaVersion` envelope (metadata, song,
 * arrangement chunks, clips), so all of them are bumped in lockstep; leaving one
 * behind would make the decoded aggregate fail its version check.
 */
const migrateV1ToV2: ProjectMigration = {
  from: 1,
  to: 2,
  description: "Add the project pack shelf (addedPacks), seeded from dependencies",
  migrate(documents) {
    return {
      ...documents,
      metadata: metadataV1ToV2(asRecord(documents.metadata)),
      song: bumpVersion(documents.song, 2),
      clips: documents.clips.map((clip) => bumpVersion(clip, 2)),
      ...(documents.arrangement
        ? {
            arrangement: documents.arrangement.map((chunk) => bumpVersion(chunk, 2)),
          }
        : {}),
    };
  },
};

/** The metadata-tier transform each migration applies, keyed by source version. */
const METADATA_MIGRATIONS: ReadonlyMap<
  number,
  (metadata: Record<string, unknown>) => Record<string, unknown>
> = new Map([[1, metadataV1ToV2]]);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Sets a document's `schemaVersion` envelope field, leaving the rest intact. */
function bumpVersion(document: unknown, to: number): Record<string, unknown> {
  return { ...asRecord(document), schemaVersion: to };
}

/**
 * The schema-migration harness (PRJ-04).
 *
 * Schema v1 is the first production schema, so there is nothing to migrate yet
 * and `PROJECT_MIGRATIONS` is deliberately empty. What exists now is the
 * mechanism and its rules, so the first post-v1 migration is a data change
 * rather than an architecture decision made under pressure:
 *
 * - A document from a **newer** schema version is never read and never
 *   overwritten. It is reported so the UI can tell the user to update, which is
 *   the only safe response to state this build does not understand.
 * - A document from an **older** version is upgraded by applying every
 *   registered migration in order. A gap in the chain is an error, not a
 *   best-effort partial upgrade.
 * - Migration is pure: it maps stored documents to stored documents, and the
 *   result still goes through `decodeProject`, so a migration cannot smuggle
 *   invalid state into the domain.
 *
 * **Fixture convention.** Every migration ships with a fixture of its source
 * version at `public/fixtures/persistence/v{version}-{name}.json`, holding the
 * `RawProjectDocuments` shape as it was actually stored. A migration's tests
 * load each supported source fixture, run `migrateProjectDocuments`, and assert
 * the result decodes to a valid project — PRJ-04's "every migration introduced
 * after schema v1 has fixture-based tests from each supported source version".
 */

export interface ProjectMigration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  migrate(documents: RawProjectDocuments): RawProjectDocuments;
}

/** Ordered, gap-free chain of migrations up to `SCHEMA_VERSION`. */
export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = [migrateV1ToV2];

export type MigrationFailureReason =
  | "future_version"
  | "unknown_version"
  | "missing_version";

export type MigrationResult =
  | {
      readonly ok: true;
      readonly documents: RawProjectDocuments;
      /** Descriptions of the migrations applied, in order. */
      readonly applied: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: MigrationFailureReason;
      readonly message: string;
      readonly storedVersion: number | null;
    };

/** The schema version a stored project declares, or `null` when unreadable. */
export function storedSchemaVersion(documents: RawProjectDocuments): number | null {
  const metadata = documents.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  const version = (metadata as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

/** Upgrades stored documents to `SCHEMA_VERSION`, or explains why it cannot. */
export function migrateProjectDocuments(documents: RawProjectDocuments): MigrationResult {
  const storedVersion = storedSchemaVersion(documents);
  if (storedVersion === null) {
    return {
      ok: false,
      reason: "missing_version",
      message: "Stored project declares no integer schema version",
      storedVersion: null,
    };
  }
  if (storedVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "future_version",
      message: `Stored project is at schema version ${storedVersion}; this build supports up to ${SCHEMA_VERSION} and will not read or overwrite it`,
      storedVersion,
    };
  }
  if (storedVersion === SCHEMA_VERSION) {
    return { ok: true, documents, applied: [] };
  }

  const applied: string[] = [];
  let current = documents;
  let version = storedVersion;
  while (version < SCHEMA_VERSION) {
    const migration = PROJECT_MIGRATIONS.find((entry) => entry.from === version);
    if (!migration) {
      return {
        ok: false,
        reason: "unknown_version",
        message: `No migration is registered from schema version ${version}; stored state is left untouched`,
        storedVersion,
      };
    }
    current = migration.migrate(current);
    applied.push(migration.description);
    version = migration.to;
  }
  return { ok: true, documents: current, applied };
}

/**
 * The load path: migrate stored documents forward, then decode them.
 *
 * A project saved at an older schema version is upgraded to the current one
 * before validation, so opening it never fails just because it predates a field
 * this build added (LIB-08). A future or unmigratable version is a decode
 * failure the caller surfaces the same way any other unreadable state is — the
 * documents are never overwritten. Migration is read-time and pure: the upgraded
 * project persists at the new version the next time it is saved, not as a side
 * effect of loading it.
 */
export function decodeStoredProject(
  documents: RawProjectDocuments,
): DecodeResult<Project> {
  const migrated = migrateProjectDocuments(documents);
  if (!migrated.ok) {
    return {
      ok: false,
      issues: [
        {
          code:
            migrated.reason === "future_version"
              ? "unsupported_schema_version"
              : "invalid_shape",
          path: ["metadata", "schemaVersion"],
          message: migrated.message,
        },
      ],
    };
  }
  return decodeProject(migrated.documents);
}

/**
 * The dashboard's read path: migrate a lone metadata document forward, then
 * decode it. The dashboard reads only the metadata tier, so it cannot run the
 * full-project migration — but a project saved before this field must still
 * appear in the list (LIB-08 acceptance: migrate forward without a user-visible
 * failure). Only the metadata half of each migration is applied here.
 */
export function decodeStoredProjectMetadata(
  projectId: string,
  raw: unknown,
): DecodeResult<ProjectMetadata> {
  const data = asRecord(raw);
  const storedVersion =
    typeof data.schemaVersion === "number" && Number.isInteger(data.schemaVersion)
      ? data.schemaVersion
      : null;
  if (storedVersion === null || storedVersion > SCHEMA_VERSION) {
    // Let the decoder report a missing or future version the usual way.
    return decodeProjectMetadata(projectId, raw);
  }
  let current = data;
  let version = storedVersion;
  while (version < SCHEMA_VERSION) {
    const migrate = METADATA_MIGRATIONS.get(version);
    if (!migrate) {
      return decodeProjectMetadata(projectId, raw);
    }
    current = migrate(current);
    version += 1;
  }
  return decodeProjectMetadata(projectId, current);
}
