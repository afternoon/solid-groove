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
 * Only the metadata tier changes shape; every other tier just moves its
 * version envelope.
 */
const migrateV1ToV2: ProjectMigration = {
  from: 1,
  to: 2,
  description: "Add the project pack shelf (addedPacks), seeded from dependencies",
  metadata: metadataV1ToV2,
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
 * - A document from a **newer** schema version is never read and never
 *   overwritten. It is reported so the UI can tell the user to update, which is
 *   the only safe response to state this build does not understand.
 * - A document from an **older** version is upgraded by applying every
 *   registered migration in order. A gap in the chain is an error, not a
 *   best-effort partial upgrade.
 * - **Every stored document is migrated from its own `schemaVersion`**, not
 *   the metadata's. Tiers are saved independently and migration is read-time
 *   only, so the first save of a migrated project leaves tiers at different
 *   versions on disk: a song edit rewrites the song and metadata at the current
 *   version and leaves the clips where they were; a note edit rewrites one clip
 *   and the metadata. The next load has to accept that mix.
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

/** One stored document's transform within a migration. */
export type DocumentMigration = (
  document: Record<string, unknown>,
) => Record<string, unknown>;

/** The stored tiers a migration transforms, one document at a time. */
export type StoredTier = "metadata" | "song" | "clip" | "chunk";

/**
 * One step of the chain. Each tier's transform maps a single stored document,
 * never the whole project, so it can run on a project whose tiers disagree
 * about their version. A tier with no transform only moves its version
 * envelope. A migration that needed two tiers at once cannot be expressed here,
 * and that is deliberate: it could not be applied to a mixed-version project.
 */
export interface ProjectMigration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  readonly metadata?: DocumentMigration;
  readonly song?: DocumentMigration;
  readonly clip?: DocumentMigration;
  readonly chunk?: DocumentMigration;
}

/** Ordered, gap-free chain of migrations up to `SCHEMA_VERSION`. */
export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = [migrateV1ToV2];

export type MigrationFailureReason =
  | "future_version"
  | "unknown_version"
  | "missing_version";

type MigrationFailure = {
  readonly ok: false;
  readonly reason: MigrationFailureReason;
  readonly message: string;
  readonly storedVersion: number | null;
  /** The stored field that failed, for the decoder's issue path. */
  readonly path: ReadonlyArray<string | number>;
};

export type MigrationResult =
  | {
      readonly ok: true;
      readonly documents: RawProjectDocuments;
      /** Descriptions of the migrations applied to any document, in order. */
      readonly applied: readonly string[];
    }
  | MigrationFailure;

type DocumentResult =
  | { readonly ok: true; readonly document: unknown; readonly from: number }
  | MigrationFailure;

function versionOf(document: unknown): number | null {
  const version = asRecord(document).schemaVersion;
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

/** The schema version a stored project's metadata declares, or `null`. */
export function storedSchemaVersion(documents: RawProjectDocuments): number | null {
  return versionOf(documents.metadata);
}

/**
 * Upgrades one stored document from the version it declares. A child document
 * with no integer version is passed through for the decoder to report; metadata
 * with none is a failure, because its version is the project's.
 */
function migrateDocument(
  document: unknown,
  tier: StoredTier,
  path: ReadonlyArray<string | number>,
): DocumentResult {
  const storedVersion = versionOf(document);
  const failure = (
    reason: MigrationFailureReason,
    message: string,
  ): MigrationFailure => ({
    ok: false,
    reason,
    message,
    storedVersion,
    path: [...path, "schemaVersion"],
  });
  if (storedVersion === null) {
    return tier === "metadata"
      ? failure("missing_version", "Stored project declares no integer schema version")
      : { ok: true, document, from: SCHEMA_VERSION };
  }
  if (storedVersion > SCHEMA_VERSION) {
    return failure(
      "future_version",
      `Stored project is at schema version ${storedVersion}; this build supports up to ${SCHEMA_VERSION} and will not read or overwrite it`,
    );
  }
  let current = asRecord(document);
  for (let version = storedVersion; version < SCHEMA_VERSION; version += 1) {
    const migration = PROJECT_MIGRATIONS.find((entry) => entry.from === version);
    if (!migration) {
      return failure(
        "unknown_version",
        `No migration is registered from schema version ${version}; stored state is left untouched`,
      );
    }
    const transform = migration[tier];
    current = bumpVersion(transform ? transform(current) : current, migration.to);
  }
  return {
    ok: true,
    document: storedVersion === SCHEMA_VERSION ? document : current,
    from: storedVersion,
  };
}

/** Upgrades stored documents to `SCHEMA_VERSION`, or explains why it cannot. */
export function migrateProjectDocuments(documents: RawProjectDocuments): MigrationResult {
  const clipCount = documents.clips.length;
  const results: DocumentResult[] = [
    migrateDocument(documents.metadata, "metadata", ["metadata"]),
    migrateDocument(documents.song, "song", ["song"]),
    ...documents.clips.map((clip, index) =>
      migrateDocument(clip, "clip", ["clips", index]),
    ),
    ...(documents.arrangement ?? []).map((chunk, index) =>
      migrateDocument(chunk, "chunk", ["arrangement", index]),
    ),
  ];
  const migrated: unknown[] = [];
  let oldest = SCHEMA_VERSION;
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    migrated.push(result.document);
    oldest = Math.min(oldest, result.from);
  }
  if (oldest === SCHEMA_VERSION) {
    return { ok: true, documents, applied: [] };
  }
  return {
    ok: true,
    documents: {
      ...documents,
      metadata: migrated[0],
      song: migrated[1],
      clips: migrated.slice(2, 2 + clipCount),
      ...(documents.arrangement ? { arrangement: migrated.slice(2 + clipCount) } : {}),
    },
    applied: PROJECT_MIGRATIONS.filter((migration) => migration.from >= oldest).map(
      (migration) => migration.description,
    ),
  };
}

/**
 * The load path: migrate stored documents forward, then decode them.
 *
 * A project saved at an older schema version is upgraded to the current one
 * before validation, so opening it never fails just because it predates a field
 * this build added (LIB-08). A future or unmigratable version is a decode
 * failure the caller surfaces the same way any other unreadable state is — the
 * documents are never overwritten. Migration is read-time and pure: each tier
 * persists at the new version the next time that tier is saved, not as a side
 * effect of loading it, which is why tiers are migrated one by one.
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
          path: migrated.path,
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
  const migrated = migrateDocument(raw, "metadata", []);
  // A missing, future or unmigratable version is reported the usual way.
  return decodeProjectMetadata(projectId, migrated.ok ? migrated.document : raw);
}
