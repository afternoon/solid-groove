import { describe, expect, it } from "vitest";
import {
	COMMAND_TYPES,
	commandRegistry,
	findCommand,
	isRegisteredCommand,
	requireCommand,
} from "./registry";
import { ABSENT_IDS } from "./testProjects";

/**
 * The registry is a published contract: `FND-009`, Alpha Milestone 1 features, and the
 * assistant all dispatch through these types. Adding one is deliberate work,
 * so the expected set is pinned here rather than derived from the registry it
 * is meant to check.
 */
const EXPECTED_COMMANDS = [
	"note.add",
	"note.remove",
	"note.update",
	"notes.transpose",
	"notes.scaleVelocity",
	"notes.quantize",
	"notes.duplicate",
	"notes.clear",
	"notes.vary",
	"clip.create",
	"clip.delete",
	"clip.update",
	"track.create",
	"track.delete",
	"track.update",
	"track.reorder",
	"track.setFlag",
	"placement.create",
	"placement.delete",
	"placement.update",
	"parameter.set",
	"instrument.change",
	"instrument.setSample",
];

describe("command registry", () => {
	it("registers exactly the published command set", () => {
		expect([...COMMAND_TYPES].sort()).toEqual([...EXPECTED_COMMANDS].sort());
	});

	it("registers each type once", () => {
		expect(new Set(COMMAND_TYPES).size).toBe(COMMAND_TYPES.length);
		expect(commandRegistry().size).toBe(COMMAND_TYPES.length);
	});

	it("namespaces every command type and versions it", () => {
		for (const type of COMMAND_TYPES) {
			expect(type, `${type} should be namespaced`).toMatch(
				/^[a-z]+\.[a-zA-Z]+$/,
			);
			expect(requireCommand(type).version).toBe(1);
		}
	});

	it("reports an unregistered type rather than guessing", () => {
		expect(findCommand("note.explode")).toBeUndefined();
		expect(isRegisteredCommand("note.explode")).toBe(false);
		expect(() => requireCommand("note.explode")).toThrow(/Unknown command/);
	});

	it("rejects an empty payload for every registered command", () => {
		for (const type of COMMAND_TYPES) {
			const parsed = requireCommand(type).parsePayload({});
			expect(parsed.ok, `${type} accepted an empty payload`).toBe(false);
		}
	});

	it("rejects a non-object payload for every registered command", () => {
		for (const type of COMMAND_TYPES) {
			for (const payload of [null, undefined, 7, "note", []]) {
				const parsed = requireCommand(type).parsePayload(payload);
				expect(
					parsed.ok,
					`${type} accepted ${JSON.stringify(payload) ?? "undefined"}`,
				).toBe(false);
			}
		}
	});

	it("rejects unknown payload keys rather than ignoring them", () => {
		const parsed = requireCommand("notes.clear").parsePayload({
			clipId: ABSENT_IDS.clip,
			sneaky: true,
		});
		expect(parsed.ok).toBe(false);
	});
});
