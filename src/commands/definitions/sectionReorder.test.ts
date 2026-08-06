import { describe, expect, it } from "vitest";
import { bars, createSection } from "../../domain";
import { createCommandHistory } from "../history";
import {
	ABSENT_IDS,
	createCommandTestProject,
	createTestFactoryContext,
} from "../testProjects";
import { layoutReorder, movedSections, sectionsInOrder } from "./sectionLayout";
import { addSection, reorderSection, updateSection } from "./sections";

/**
 * `section.reorder` (`ARR-003`; PRD ARR-02: "Reordering a section moves its
 * contained clip placements as one undoable operation").
 *
 * The fixture holds two back-to-back one-bar sections: "Intro" at bar 1 with
 * placement A inside it, "Drop" at bar 2 with placement B inside it.
 */

type Fixture = ReturnType<typeof createCommandTestProject>;

function starts(project: Fixture["project"]) {
	return sectionsInOrder(project.song.sections).map((section) => [
		section.name,
		section.startTicks,
	]);
}

function placementStart(project: Fixture["project"], placementId: string) {
	return project.song.placements.find((p) => p.id === placementId)?.startTicks;
}

describe("section.reorder", () => {
	it("moves the contained placements with the section, in one transaction", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		const revisionBefore = fixture.project.metadata.revision;

		const result = history.execute(reorderSection(fixture.sectionIds[0], 1));

		expect(result.ok).toBe(true);
		expect(starts(history.project)).toEqual([
			["Drop", 0],
			["Intro", bars(1)],
		]);
		// Each section's placement travelled with it — no hidden audio, but the
		// clips the section labelled did move (ARR-02).
		expect(placementStart(history.project, fixture.placementAId)).toBe(bars(1));
		expect(placementStart(history.project, fixture.placementBId)).toBe(0);
		// ...but no clip was created, copied, or deleted (ARR-02).
		expect(history.project.clips).toEqual(fixture.project.clips);
		// One command, one revision, one history entry (PRD 9.6).
		expect(history.project.metadata.revision).toBe(revisionBefore + 1);
		expect(history.entries).toHaveLength(1);
	});

	it("undoes the section move and the placement move together", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);

		history.execute(reorderSection(fixture.sectionIds[0], 1));
		history.undo();

		expect(starts(history.project)).toEqual(starts(fixture.project));
		expect(placementStart(history.project, fixture.placementAId)).toBe(0);
		expect(placementStart(history.project, fixture.placementBId)).toBe(bars(1));
	});

	it("moves a partially overlapping placement once, with the section it starts in", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		// Straddle the Intro/Drop boundary: starts half a bar into Intro and runs
		// two bars, past Drop's end. Its start is inside Intro, so it belongs to
		// Intro and moves exactly once.
		history.execute({
			type: "placement.update",
			payload: {
				placementId: fixture.placementAId,
				changes: { startTicks: bars(1) - 96, durationTicks: bars(2) },
			},
		});

		const result = history.execute(reorderSection(fixture.sectionIds[0], 1));

		expect(result.ok).toBe(true);
		expect(placementStart(history.project, fixture.placementAId)).toBe(
			bars(2) - 96,
		);
	});

	it("leaves a placement outside every moved section exactly where it is", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		// A third section at bar 3 that the Intro/Drop swap does not move, and a
		// placement inside it.
		history.execute(
			addSection(
				createSection(createTestFactoryContext("sec-tail"), {
					name: "Outro",
					startTicks: bars(2),
					durationTicks: bars(1),
				}),
			),
		);
		history.execute({
			type: "placement.update",
			payload: {
				placementId: fixture.placementBId,
				changes: { startTicks: bars(2) },
			},
		});

		history.execute(reorderSection(fixture.sectionIds[0], 1));

		// Intro and Drop swapped; Outro's start never changed, so its placement
		// did not move either.
		expect(placementStart(history.project, fixture.placementBId)).toBe(bars(2));
	});

	it("rejects a no-op reorder and a missing section without changing anything", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);

		expect(history.execute(reorderSection(fixture.sectionIds[0], 0)).ok).toBe(
			false,
		);
		expect(history.execute(reorderSection(ABSENT_IDS.section, 1)).ok).toBe(
			false,
		);
		expect(history.project).toBe(fixture.project);
	});

	it("clamps an out-of-range destination rather than dropping a section", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);

		const result = history.execute(reorderSection(fixture.sectionIds[0], 99));

		expect(result.ok).toBe(true);
		expect(starts(history.project)).toEqual([
			["Drop", 0],
			["Intro", bars(1)],
		]);
	});

	it("keeps the run gapless when the sections have different lengths", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		history.execute(
			updateSection(fixture.sectionIds[0], { durationTicks: bars(3) }),
		);

		history.execute(reorderSection(fixture.sectionIds[0], 1));

		// Drop (1 bar) now starts the run, Intro (3 bars) follows it immediately.
		expect(starts(history.project)).toEqual([
			["Drop", 0],
			["Intro", bars(1)],
		]);
	});
});

describe("layoutReorder", () => {
	it("returns null for a single section, an unknown ID, and a no-op", () => {
		const fixture = createCommandTestProject();
		const sections = fixture.project.song.sections;
		expect(layoutReorder(sections, ABSENT_IDS.section, 1)).toBeNull();
		expect(layoutReorder(sections, fixture.sectionIds[0], 0)).toBeNull();
		expect(layoutReorder([sections[0]], sections[0].id, 1)).toBeNull();
	});

	it("gives a delta only to the sections whose start actually changed", () => {
		const fixture = createCommandTestProject();
		const layout = layoutReorder(
			fixture.project.song.sections,
			fixture.sectionIds[0],
			1,
		);
		expect(layout).not.toBeNull();
		if (!layout) return;
		// Both swapped, so both moved: Intro forward one bar, Drop back one bar.
		expect(layout.deltas.get(fixture.sectionIds[0])).toBe(bars(1));
		expect(layout.deltas.get(fixture.sectionIds[1])).toBe(-bars(1));
		// `movedSections` is the hook ARR-004 reuses for automation: it reports
		// each moved section against its *pre-move* range.
		expect(
			movedSections(fixture.project.song, layout).map((entry) => [
				entry.section.name,
				entry.section.startTicks,
				entry.delta,
			]),
		).toEqual([
			["Intro", 0, bars(1)],
			["Drop", bars(1), -bars(1)],
		]);
	});
});
