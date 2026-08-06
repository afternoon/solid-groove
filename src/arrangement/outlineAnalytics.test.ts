/**
 * ARR-03's loop-to-song action through the section controller, and its OPS-02
 * obligation: `arrangement_outline_created` fires exactly once per outline,
 * with the template ID and section count and nothing else, and only when the
 * transaction actually landed.
 */

import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import { bars } from "../domain";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { memoryStorage } from "../testing/storage";
import { OUTLINE_TEMPLATES } from "./outlineTemplates";
import { createSectionEditing } from "./sectionEditingController";

const AUTOMATIC = new Set(["release_sha", "surface"]);
const declared = (params: Readonly<Record<string, unknown>>) =>
	Object.keys(params)
		.filter((key) => !AUTOMATIC.has(key))
		.sort();

function template(id: string) {
	const found = OUTLINE_TEMPLATES.find((entry) => entry.id === id);
	if (!found) throw new Error(`missing template ${id}`);
	return found;
}

function harness(options: { analyticsAllowed?: boolean } = {}) {
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const allowed = options.analyticsAllowed ?? true;
	consent.set({ productAnalytics: allowed, errorMonitoring: allowed });
	let project: Project = createSliceFixtureProject();
	const editing = createSectionEditing({
		getProject: () => project,
		dispatch: (commands: readonly RawCommandInput[]) => {
			const result = executeTransaction(project, commands);
			if (result.ok) project = result.project;
			return result.ok;
		},
		ids: createSeededIdFactory("outline"),
		analytics: new Analytics({
			transport,
			consent,
			storage: memoryStorage(),
		}),
	});
	return {
		editing,
		transport,
		getProject: () => project,
		named: (name: string) =>
			transport.events.filter((event) => event.name === name),
		/** The end of the fixture's existing material — a real loop range. */
		loopEnd: () =>
			Math.max(
				...project.song.placements.map((p) => p.startTicks + p.durationTicks),
			),
	};
}

describe("createOutline", () => {
	it("fires arrangement_outline_created once, with template ID and count", () => {
		const h = harness();
		const aaba = template("aaba");

		expect(h.editing.createOutline(aaba, "linked", 0, h.loopEnd())).toBeNull();

		const outline = h.named("arrangement_outline_created");
		expect(outline).toHaveLength(1);
		expect(outline[0].params.template_id).toBe("aaba");
		expect(outline[0].params.section_count).toBe(aaba.steps.length);
		// Only the two declared parameters travel — no name, no project ID.
		expect(declared(outline[0].params)).toEqual([
			"section_count",
			"template_id",
		]);
	});

	it("reports one section_created per outline section, all `template`", () => {
		const h = harness();
		const aaba = template("aaba");

		h.editing.createOutline(aaba, "linked", 0, h.loopEnd());

		const created = h.named("section_created");
		expect(created).toHaveLength(aaba.steps.length);
		expect(created.every((e) => e.params.origin === "template")).toBe(true);
	});

	it("marks the `sections` feature first use once, alongside the outline", () => {
		const h = harness();

		h.editing.createOutline(template("aaba"), "linked", 0, h.loopEnd());
		h.editing.createOutline(template("basic_song"), "linked", 0, h.loopEnd());

		expect(h.named("feature_first_use")).toHaveLength(1);
		expect(h.named("arrangement_outline_created")).toHaveLength(2);
	});

	it("logs nothing at all when the outline is refused", () => {
		const h = harness();

		// Far past every placement, so there is nothing in the loop range.
		expect(
			h.editing.createOutline(template("aaba"), "linked", bars(200), bars(202)),
		).toBe("no_placements_in_loop");

		expect(h.transport.events).toEqual([]);
	});

	it("actually creates the sections and placements it reports", () => {
		const h = harness();
		const aaba = template("aaba");
		const before = h.getProject();

		h.editing.createOutline(aaba, "linked", 0, h.loopEnd());

		const after = h.getProject();
		expect(after.song.sections.length).toBe(
			before.song.sections.length + aaba.steps.length,
		);
		expect(after.song.placements.length).toBeGreaterThan(
			before.song.placements.length,
		);
		// Linked mode reused the existing clips rather than forking any.
		expect(after.clips).toEqual(before.clips);
	});

	it("emits nothing when analytics is off, and the outline still lands", () => {
		const h = harness({ analyticsAllowed: false });
		const before = h.getProject().song.sections.length;

		expect(
			h.editing.createOutline(template("aaba"), "linked", 0, h.loopEnd()),
		).toBeNull();

		expect(h.transport.events).toEqual([]);
		expect(h.getProject().song.sections.length).toBeGreaterThan(before);
	});
});
