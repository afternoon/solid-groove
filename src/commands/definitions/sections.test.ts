import { describe, expect, it } from "vitest";
import {
	bars,
	createSection,
	parseProject,
	serializeProject,
} from "../../domain";
import { createCommandHistory } from "../history";
import {
	ABSENT_IDS,
	createCommandTestProject,
	createTestFactoryContext,
} from "../testProjects";
import { addSection, removeSection, updateSection } from "./sections";

/**
 * Section create/rename/resize/color commands (`ARR-003`; PRD ARR-02).
 *
 * The fixture holds two back-to-back one-bar sections — "Intro" at bar 1 with
 * placement A inside it, "Drop" at bar 2 with placement B inside it — so these
 * assertions can name what did and did not move.
 */

type Fixture = ReturnType<typeof createCommandTestProject>;

function placementStart(project: Fixture["project"], placementId: string) {
	return project.song.placements.find((p) => p.id === placementId)?.startTicks;
}

describe("section.create", () => {
	it("adds a marker without creating any clip or placement", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		const section = createSection(createTestFactoryContext("sec-create"), {
			name: "Outro",
			startTicks: bars(2),
			durationTicks: bars(2),
		});
		const result = history.execute(addSection(section));
		expect(result.ok).toBe(true);
		expect(history.project.song.sections).toHaveLength(3);
		// A section labels a range; it holds no audio of its own (ARR-02).
		expect(history.project.clips).toEqual(fixture.project.clips);
		expect(history.project.song.placements).toEqual(
			fixture.project.song.placements,
		);
	});

	it("rejects a duplicate section ID", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		const result = history.execute(
			addSection(fixture.project.song.sections[0]),
		);
		expect(result.ok).toBe(false);
		expect(history.project).toBe(fixture.project);
	});
});

describe("section.delete", () => {
	it("removes the label and leaves the placements it labelled alone", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);

		const result = history.execute(removeSection(fixture.sectionIds[1]));
		expect(result.ok).toBe(true);
		expect(history.project.song.sections).toHaveLength(1);
		expect(placementStart(history.project, fixture.placementBId)).toBe(bars(1));
		expect(history.project.clips).toEqual(fixture.project.clips);
	});

	it("rejects a section that does not exist", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		const result = history.execute(removeSection(ABSENT_IDS.section));
		expect(result.ok).toBe(false);
		expect(history.project).toBe(fixture.project);
	});
});

describe("section.update", () => {
	it("renames, recolors, and resizes through one command", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);

		const result = history.execute(
			updateSection(fixture.sectionIds[0], {
				name: "Build",
				color: "#123456",
				durationTicks: bars(4),
			}),
		);
		expect(result.ok).toBe(true);
		const section = history.project.song.sections.find(
			(candidate) => candidate.id === fixture.sectionIds[0],
		);
		expect(section?.name).toBe("Build");
		expect(section?.color).toBe("#123456");
		expect(section?.durationTicks).toBe(bars(4));
		// Resizing the label moved no audio (ARR-02).
		expect(placementStart(history.project, fixture.placementAId)).toBe(0);
		expect(placementStart(history.project, fixture.placementBId)).toBe(bars(1));
	});

	it("rejects an empty change set rather than burning a revision", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		const result = history.execute({
			type: "section.update",
			payload: { sectionId: fixture.sectionIds[0], changes: {} },
		});
		expect(result.ok).toBe(false);
		expect(history.project).toBe(fixture.project);
	});

	it("round-trips every edited field through serialize + parse", () => {
		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		history.execute(
			updateSection(fixture.sectionIds[0], {
				name: "Build",
				color: "#abcdef",
				durationTicks: bars(3),
			}),
		);

		const reloaded = parseProject(
			JSON.parse(JSON.stringify(serializeProject(history.project))),
		);
		expect(reloaded.ok).toBe(true);
		if (!reloaded.ok) return;
		expect(reloaded.value.song.sections).toEqual(history.project.song.sections);
	});
});
