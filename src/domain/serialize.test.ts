import { describe, expect, it } from "vitest";
import { createReferenceProject, createSliceFixtureProject } from "./fixtures";
import { assertProject, parseProject } from "./parse";
import { serializeProject, stringifyProject } from "./serialize";

describe("schema-v1 serialization", () => {
	it("round trips through JSON-compatible values", () => {
		const project = createSliceFixtureProject();
		const json = JSON.parse(stringifyProject(project));
		const reparsed = assertProject(json);

		expect(serializeProject(reparsed)).toEqual(serializeProject(project));
		expect(stringifyProject(reparsed)).toBe(stringifyProject(project));
	});

	it("emits only JSON primitives, arrays, and plain objects", () => {
		const serialized = serializeProject(createSliceFixtureProject());
		walk(serialized, (value) => {
			const type = typeof value;
			if (value === null || type === "string" || type === "boolean") {
				return;
			}
			expect(type).toBe("number");
			expect(Number.isFinite(value as number)).toBe(true);
		});
	});

	it("is byte-identical for two independently built copies of a fixture", () => {
		expect(stringifyProject(createSliceFixtureProject())).toBe(
			stringifyProject(createSliceFixtureProject()),
		);
	});

	it("does not depend on collection insertion order", () => {
		const project = createSliceFixtureProject();
		const shuffled = assertProject({
			...project,
			song: {
				...project.song,
				tracks: [...project.song.tracks].reverse(),
				placements: [...project.song.placements].reverse(),
			},
			clips: [...project.clips].reverse(),
		});

		expect(stringifyProject(shuffled)).toBe(stringifyProject(project));
	});

	it("does not depend on object key order", () => {
		const project = createSliceFixtureProject();
		const rekeyed = JSON.parse(
			JSON.stringify(serializeProject(project), (_key, value) =>
				isPlainObject(value) ? reverseKeys(value) : value,
			),
		);
		const result = parseProject(rekeyed);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(stringifyProject(result.value)).toBe(stringifyProject(project));
		}
	});

	it("round trips a ten-minute, fifty-track reference arrangement", () => {
		const project = createReferenceProject();
		const round = assertProject(JSON.parse(stringifyProject(project)));
		expect(stringifyProject(round)).toBe(stringifyProject(project));
	});
});

function walk(value: unknown, visit: (leaf: unknown) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			walk(item, visit);
		}
		return;
	}
	if (isPlainObject(value)) {
		for (const item of Object.values(value)) {
			walk(item, visit);
		}
		return;
	}
	visit(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" && value !== null && value.constructor === Object
	);
}

function reverseKeys(value: Record<string, unknown>): Record<string, unknown> {
	const reversed: Record<string, unknown> = {};
	for (const key of Object.keys(value).reverse()) {
		reversed[key] = value[key];
	}
	return reversed;
}
