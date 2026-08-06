/**
 * ARR-003's OPS-02 obligations, asserted at the controller that owns them.
 *
 * Each event must fire exactly once per action, carry no user text, and stop
 * entirely when analytics consent is withdrawn — while the edits themselves
 * still land, because disabling analytics changes nothing about behavior.
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
import { createSectionEditing } from "./sectionEditingController";

/** An event's own parameters, minus the ones every event carries. */
const AUTOMATIC = new Set(["release_sha", "surface"]);
function declared(params: Readonly<Record<string, unknown>>): string[] {
	return Object.keys(params)
		.filter((key) => !AUTOMATIC.has(key))
		.sort();
}

function harness(options: { analyticsAllowed?: boolean } = {}) {
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const allowed = options.analyticsAllowed ?? true;
	consent.set({ productAnalytics: allowed, errorMonitoring: allowed });
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});

	let project: Project = createSliceFixtureProject();
	const editing = createSectionEditing({
		getProject: () => project,
		dispatch: (commands: readonly RawCommandInput[]) => {
			const result = executeTransaction(project, commands);
			if (result.ok) project = result.project;
			return result.ok;
		},
		ids: createSeededIdFactory("sections"),
		analytics,
	});

	return {
		editing,
		transport,
		getProject: () => project,
		named: (name: string) =>
			transport.events.filter((event) => event.name === name),
	};
}

describe("section_created", () => {
	it("fires exactly once per manual add, with origin `manual`", () => {
		const h = harness();

		expect(h.editing.add(bars(4), 4, "Bridge")).toBe(true);

		expect(h.named("section_created")).toHaveLength(1);
		expect(h.named("section_created")[0].params.origin).toBe("manual");
	});

	it("does not fire when nothing landed", () => {
		const transport = createRecordingTransport();
		const editing = createSectionEditing({
			getProject: () => null,
			dispatch: () => false,
			ids: createSeededIdFactory("refused"),
			analytics: new Analytics({ transport, storage: memoryStorage() }),
		});

		expect(editing.add(0)).toBe(false);
		expect(transport.events).toEqual([]);
	});

	it("carries no section name in any parameter (OPS-02)", () => {
		const h = harness();

		h.editing.add(bars(4), 4, "My Secret Drop Name");

		expect(JSON.stringify(h.transport.events)).not.toContain(
			"My Secret Drop Name",
		);
		// Only `origin` beyond the automatic params every event carries.
		expect(declared(h.named("section_created")[0].params)).toEqual(["origin"]);
	});
});

describe("feature_first_use", () => {
	it("fires once for `sections`, across every kind of section operation", () => {
		const h = harness();

		h.editing.add(bars(4), 4, "One");
		h.editing.add(bars(8), 4, "Two");
		const sectionId = h.getProject().song.sections[0].id;
		h.editing.rename(sectionId, "Renamed");
		h.editing.resize(sectionId, 8);
		h.editing.recolor(sectionId, "#123456");
		h.editing.reorder(sectionId, 1);

		const first = h.named("feature_first_use");
		expect(first).toHaveLength(1);
		expect(first[0].params.feature).toBe("sections");
	});
});

describe("arrangement_milestone", () => {
	it("needs BOTH three named sections and two minutes", () => {
		const short = harness();
		short.editing.add(bars(0), 1, "One");
		short.editing.add(bars(2), 1, "Two");
		short.editing.add(bars(4), 1, "Three");
		// Three sections, but well under two minutes.
		expect(short.named("arrangement_milestone")).toHaveLength(0);

		const few = harness();
		few.editing.add(bars(0), 128, "Long");
		few.editing.add(bars(130), 4, "Second");
		// Past two minutes, but only two sections.
		expect(few.named("arrangement_milestone")).toHaveLength(0);
	});

	it("fires once the project reaches three named sections and two minutes", () => {
		const h = harness();

		h.editing.add(bars(0), 4, "Intro");
		h.editing.add(bars(4), 4, "Drop");
		expect(h.named("arrangement_milestone")).toHaveLength(0);
		// A third named section long enough to push the arrangement past 2:00.
		h.editing.add(bars(8), 128, "Outro");

		const milestone = h.named("arrangement_milestone");
		expect(milestone).toHaveLength(1);
		expect(declared(milestone[0].params)).toEqual([
			"duration_bucket",
			"section_count",
		]);
		expect(typeof milestone[0].params.duration_bucket).toBe("string");
		expect(milestone[0].params.section_count).toBe(3);
	});

	it("fires at most once per project, however many further edits land", () => {
		const h = harness();
		h.editing.add(bars(0), 4, "Intro");
		h.editing.add(bars(4), 4, "Drop");
		h.editing.add(bars(8), 128, "Outro");
		h.editing.add(bars(140), 8, "Another");
		h.editing.checkMilestone();
		expect(h.named("arrangement_milestone")).toHaveLength(1);
	});
});

describe("consent", () => {
	it("emits nothing when analytics is off, and edits still land", () => {
		const h = harness({ analyticsAllowed: false });
		const before = h.getProject().song.sections.length;

		h.editing.add(bars(4), 4, "Bridge");
		h.editing.rename(h.getProject().song.sections[0].id, "Renamed");

		expect(h.transport.events).toEqual([]);
		expect(h.getProject().song.sections.length).toBeGreaterThan(before);
	});
});
