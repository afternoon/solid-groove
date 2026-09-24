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
 * Every other tier only has its `schemaVersion` envelope bumped.
 */
const migrateV1ToV2: ProjectMigration = {
  from: 1,
  to: 2,
  description: "Add the project pack shelf (addedPacks), seeded from dependencies",
  migrate: (document, tier) =>
    tier === "metadata" ? metadataV1ToV2(document) : bumpVersion(document, 2),
};

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

/** The stored tiers; each document carries its own `schemaVersion` envelope. */
export type StoredTier = "metadata" | "song" | "clip" | "arrangement";

export interface ProjectMigration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  /** Upgrades one stored document of `tier` from version `from` to `to`. */
  migrate(document: Record<string, unknown>, tier: StoredTier): Record<string, unknown>;
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

  // Every document is migrated from the version it declares itself, not the
  // metadata's: saves are tier-local, so a project read at an older version
  // and then saved one tier at a time is stored at mixed versions (#290).
  const applied = new Set<string>();
  let failure: MigrationResult | null = null;
  const upgrade = (document: unknown, tier: StoredTier): unknown => {
    const version = asRecord(document).schemaVersion;
    if (failure || !Number.isInteger(version) || (version as number) >= SCHEMA_VERSION) {
      // Current, future or malformed: the decoder reports what is wrong.
      return document;
    }
    let current = asRecord(document);
    for (let from = version as number; from < SCHEMA_VERSION; from += 1) {
      const migration = PROJECT_MIGRATIONS.find((entry) => entry.from === from);
      if (!migration) {
        failure = {
          ok: false,
          reason: "unknown_version",
          message: `No migration is registered from schema version ${from}; stored state is left untouched`,
          storedVersion: version as number,
        };
        return document;
      }
      current = migration.migrate(current, tier);
      applied.add(migration.description);
    }
    return current;
  };

  const migrated: RawProjectDocuments = {
    ...documents,
    metadata: upgrade(documents.metadata, "metadata"),
    song: upgrade(documents.song, "song"),
    clips: documents.clips.map((clip) => upgrade(clip, "clip")),
    ...(documents.arrangement
      ? {
          arrangement: documents.arrangement.map((chunk) =>
            upgrade(chunk, "arrangement"),
          ),
        }
      : {}),
  };
  if (failure) {
    return failure;
  }
  return applied.size === 0
    ? { ok: true, documents, applied: [] }
    : { ok: true, documents: migrated, applied: [...applied] };
}

/**
 * The load path: migrate stored documents forward, then decode them.
 *
 * A project saved at an older schema version is upgraded to the current one
 * before validation, so opening it never fails just because it predates a field
 * this build added (LIB-08). A future or unmigratable version is a decode
 * failure the caller surfaces the same way any other unreadable state is — the
 * documents are never overwritten. Migration is read-time and pure, and each
 * document migrates from its own declared version: saves are tier-local, so an
 * upgraded project reaches storage one tier at a time as each is next saved,
 * and a load in between reads documents at mixed versions.
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
  for (let version = storedVersion; version < SCHEMA_VERSION; version += 1) {
    const migration = PROJECT_MIGRATIONS.find((entry) => entry.from === version);
    if (!migration) {
      return decodeProjectMetadata(projectId, raw);
    }
    current = migration.migrate(current, "metadata");
  }
  return decodeProjectMetadata(projectId, current);
}
