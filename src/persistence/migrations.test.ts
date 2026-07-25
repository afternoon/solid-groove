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
	it("passes a schema-v1 project through untouched", async () => {
		const stored = await loadStoredProjectFixture("v1-slice-project.json");

		const result = migrateProjectDocuments(stored);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.applied).toEqual([]);
		expect(result.documents).toBe(stored);
	});

	it("decodes the checked-in schema-v1 fixture into the fixture project", async () => {
		// This pins the stored wire format: if encoding changes shape, the file on
		// disk stops decoding and the change has to be a deliberate migration.
		const stored = await loadStoredProjectFixture("v1-slice-project.json");

		const decoded = decodeProject(stored);

		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(stringifyProject(decoded.value)).toBe(
			stringifyProject(createSliceFixtureProject()),
		);
	});

	it("refuses a newer schema version without touching it", async () => {
		const stored = await loadStoredProjectFixture("v2-future-project.json");

		const result = migrateProjectDocuments(stored);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("future_version");
		expect(result.storedVersion).toBe(2);
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
			PROJECT_MIGRATIONS.length > 0
				? PROJECT_MIGRATIONS[0].from
				: SCHEMA_VERSION;
		for (const migration of PROJECT_MIGRATIONS) {
			expect(migration.from).toBe(version);
			expect(migration.to).toBe(version + 1);
			version = migration.to;
		}
		expect(version).toBe(SCHEMA_VERSION);
	});
});
