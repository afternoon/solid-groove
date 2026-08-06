import { describe, expect, it } from "vitest";
import { OUTLINE_TEMPLATE_IDS } from "../analytics/catalog";
import {
	findOutlineTemplate,
	OUTLINE_TEMPLATES,
	templateBars,
} from "./outlineTemplates";

/** Arrangement outline templates (`ARR-003`; PRD ARR-03). */

describe("OUTLINE_TEMPLATES", () => {
	it("pins exactly the template IDs the analytics catalog declares", () => {
		// Same contract as COMMAND_IDS: `template_id` is a published value set, so
		// a template cannot be added without deciding how it appears in a report.
		expect(OUTLINE_TEMPLATES.map((template) => template.id).sort()).toEqual(
			[...OUTLINE_TEMPLATE_IDS].sort(),
		);
	});

	it("offers at least one editable structure template (ARR-03)", () => {
		expect(OUTLINE_TEMPLATES.length).toBeGreaterThanOrEqual(1);
	});

	it("gives every template named, positive-length steps", () => {
		for (const template of OUTLINE_TEMPLATES) {
			expect(template.steps.length).toBeGreaterThan(0);
			expect(template.label).not.toBe("");
			expect(template.description).not.toBe("");
			for (const step of template.steps) {
				expect(step.name).not.toBe("");
				expect(step.bars).toBeGreaterThan(0);
				expect(Number.isInteger(step.bars)).toBe(true);
			}
		}
	});

	it("uses no unique IDs twice", () => {
		const ids = OUTLINE_TEMPLATES.map((template) => template.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("looks a template up by ID and reports an unknown one", () => {
		expect(findOutlineTemplate("aaba")?.label).toBe("AABA");
		expect(findOutlineTemplate("not_a_template")).toBeUndefined();
	});

	it("sums a template's bars", () => {
		const aaba = findOutlineTemplate("aaba");
		expect(aaba && templateBars(aaba)).toBe(32);
	});
});
