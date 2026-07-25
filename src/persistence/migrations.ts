import { SCHEMA_VERSION } from "../domain/entities";
import type { RawProjectDocuments } from "./documents";

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
export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = [];

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
export function storedSchemaVersion(
	documents: RawProjectDocuments,
): number | null {
	const metadata = documents.metadata;
	if (typeof metadata !== "object" || metadata === null) {
		return null;
	}
	const version = (metadata as { schemaVersion?: unknown }).schemaVersion;
	return typeof version === "number" && Number.isInteger(version)
		? version
		: null;
}

/** Upgrades stored documents to `SCHEMA_VERSION`, or explains why it cannot. */
export function migrateProjectDocuments(
	documents: RawProjectDocuments,
): MigrationResult {
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
		const migration = PROJECT_MIGRATIONS.find(
			(entry) => entry.from === version,
		);
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
