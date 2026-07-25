import { describe, expect, it } from "vitest";
import {
	createIdFactory,
	createSeededIdFactory,
	ENTITY_KINDS,
	type EntityKind,
	ID_PREFIXES,
	ID_SUFFIX_LENGTH,
	idPattern,
	idSchemaFor,
	isEntityId,
	parseEntityId,
	trackIdSchema,
} from "./ids";

describe("entity ids", () => {
	it("covers every PRD section 9.4 entity with its documented prefix", () => {
		expect(ID_PREFIXES).toEqual({
			project: "prj",
			track: "trk",
			clip: "clp",
			placement: "plc",
			event: "evt",
			device: "dev",
			pad: "pad",
			automation: "aut",
			section: "sec",
			return: "ret",
			asset: "ast",
			revision: "rev",
		});
	});

	it("produces prefixed, 21-character, URL-safe ids for every kind", () => {
		const ids = createIdFactory();
		for (const kind of ENTITY_KINDS) {
			const id = ids(kind);
			expect(id).toMatch(idPattern(kind));
			expect(id.slice(ID_PREFIXES[kind].length + 1)).toHaveLength(
				ID_SUFFIX_LENGTH,
			);
			expect(encodeURIComponent(id)).toBe(id);
		}
	});

	it("does not repeat ids", () => {
		const ids = createIdFactory();
		const generated = new Set(
			Array.from({ length: 1_000 }, () => ids("event") as string),
		);
		expect(generated.size).toBe(1_000);
	});

	it("replays the same sequence for the same seed and differs across seeds", () => {
		const first = createSeededIdFactory("fixture-seed");
		const second = createSeededIdFactory("fixture-seed");
		const other = createSeededIdFactory("другой-seed");

		const firstRun = Array.from({ length: 5 }, () => first("track"));
		const secondRun = Array.from({ length: 5 }, () => second("track"));
		const otherRun = Array.from({ length: 5 }, () => other("track"));

		expect(secondRun).toEqual(firstRun);
		expect(otherRun).not.toEqual(firstRun);
		for (const id of firstRun) {
			expect(id).toMatch(idPattern("track"));
		}
	});

	it("accepts numeric seeds and keeps the production id format", () => {
		const first = createSeededIdFactory(42)("clip");
		expect(first).toMatch(idPattern("clip"));
		expect(createSeededIdFactory(42)("clip")).toBe(first);
		expect(createSeededIdFactory(43)("clip")).not.toBe(first);
	});

	it("rejects ids of the wrong kind, length, or alphabet", () => {
		const ids = createSeededIdFactory("wrong-kind");
		const trackId = ids("track");

		expect(isEntityId("track", trackId)).toBe(true);
		expect(isEntityId("clip", trackId)).toBe(false);
		expect(isEntityId("track", "trk_tooshort")).toBe(false);
		expect(isEntityId("track", `trk_${"a".repeat(22)}`)).toBe(false);
		expect(isEntityId("track", `trk_${"!".repeat(21)}`)).toBe(false);
		expect(isEntityId("track", 42)).toBe(false);
		expect(() => parseEntityId("clip", trackId)).toThrow(/Invalid clip id/);
	});

	it("exposes a runtime schema per kind that rejects a foreign prefix", () => {
		const ids = createSeededIdFactory("schema");
		const clipId = ids("clip");
		for (const kind of ENTITY_KINDS as EntityKind[]) {
			expect(idSchemaFor(kind).safeParse(ids(kind)).success).toBe(true);
		}
		expect(trackIdSchema.safeParse(clipId).success).toBe(false);
	});
});
