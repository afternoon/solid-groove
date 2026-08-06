import { describe, expect, it } from "vitest";
import { createCommandHistory } from "../commands/history";
import { createCommandTestProject } from "../commands/testProjects";
import { bars, createSeededIdFactory } from "../domain";
import {
	buildOutline,
	defaultOutlineStart,
	describeOutline,
	type OutlineMode,
	placementsInRange,
} from "./arrangementOutline";
import { OUTLINE_TEMPLATES, type OutlineTemplate } from "./outlineTemplates";

/**
 * Loop-to-song outline creation (`ARR-003`; PRD ARR-03).
 *
 * The fixture has two 1-bar placements: placement A at bar 1 and placement B at
 * bar 2, on two different tracks, plus two 1-bar sections covering them.
 */

function aaba(): OutlineTemplate {
	const template = OUTLINE_TEMPLATES.find((entry) => entry.id === "aaba");
	if (!template) throw new Error("the aaba template must exist");
	return template;
}
const AABA: OutlineTemplate = aaba();

function run(mode: OutlineMode, seed = "outline") {
	const fixture = createCommandTestProject();
	const history = createCommandHistory(fixture.project);
	const result = buildOutline({
		project: fixture.project,
		template: AABA,
		mode,
		loopStartTicks: 0,
		loopEndTicks: bars(2),
		ids: createSeededIdFactory(seed),
	});
	return { fixture, history, result };
}

describe("buildOutline", () => {
	it("states which of the two operations will run, before it runs", () => {
		expect(describeOutline("linked")).toMatch(/linked/i);
		expect(describeOutline("independent")).toMatch(/independent/i);
	});

	it("creates one section per template step, laid out back to back", () => {
		const { history, result } = run("linked");
		expect(result.refusal).toBeNull();
		expect(result.sectionCount).toBe(AABA.steps.length);

		const applied = history.execute(result.commands);
		expect(applied.ok, applied.ok ? "" : applied.issues[0]?.message).toBe(true);

		const created = history.project.song.sections.filter((section) =>
			result.sectionIds.includes(section.id),
		);
		expect(created.map((s) => s.name)).toEqual(AABA.steps.map((s) => s.name));
		// Back to back from the first free bar after the existing arrangement.
		let cursor = defaultOutlineStart(history.project) === 0 ? 0 : bars(2);
		for (const [index, section] of created.entries()) {
			expect(section.startTicks).toBe(cursor);
			cursor += AABA.steps[index].bars * bars(1);
		}
	});

	it("repeats the loop to fill each section and is immediately playable", () => {
		const { fixture, history, result } = run("linked");
		history.execute(result.commands);

		// Each 8-bar step over a 2-bar loop fits four repeats of two placements.
		const added =
			history.project.song.placements.length -
			fixture.project.song.placements.length;
		expect(added).toBe(AABA.steps.length * 4 * 2);
		// Every new placement points at a real clip on a real track, which is what
		// makes it playable through the ordinary audio projection — no separate
		// render step, and no dangling reference (the transaction would have been
		// rejected by the domain invariants otherwise).
		for (const placement of history.project.song.placements) {
			expect(
				history.project.clips.some((clip) => clip.id === placement.clipId),
			).toBe(true);
		}
	});

	it("does not modify the source clips or the source placements", () => {
		const { fixture, history, result } = run("independent");
		history.execute(result.commands);

		// Every original clip survives byte-identical (ARR-03: "without
		// destructively modifying source clips").
		for (const original of fixture.project.clips) {
			expect(history.project.clips).toContainEqual(original);
		}
		for (const original of fixture.project.song.placements) {
			expect(history.project.song.placements).toContainEqual(original);
		}
		// And it emitted no update command at all — only appends.
		expect(
			result.commands.every((command) => command.type.endsWith(".create")),
		).toBe(true);
	});

	it("reuses the source clips in linked mode and forks them per section otherwise", () => {
		const linked = run("linked");
		const independent = run("independent");

		expect(
			linked.result.commands.filter((c) => c.type === "clip.create"),
		).toEqual([]);
		// One fork of each of the two source clips, per section.
		expect(
			independent.result.commands.filter((c) => c.type === "clip.create"),
		).toHaveLength(AABA.steps.length * 2);
	});

	it("is one transaction: one revision, one history entry, undone atomically", () => {
		const { fixture, history, result } = run("linked");
		const before = fixture.project.metadata.revision;

		history.execute(result.commands);
		expect(history.project.metadata.revision).toBe(before + 1);
		expect(history.entries).toHaveLength(1);

		history.undo();
		expect(history.project.song.sections).toEqual(
			fixture.project.song.sections,
		);
		expect(history.project.song.placements).toEqual(
			fixture.project.song.placements,
		);
		expect(history.project.clips).toEqual(fixture.project.clips);
	});

	it("refuses an empty loop range and a range with nothing in it", () => {
		const fixture = createCommandTestProject();
		const base = {
			project: fixture.project,
			template: AABA,
			mode: "linked" as const,
			ids: createSeededIdFactory("refuse"),
		};

		expect(
			buildOutline({ ...base, loopStartTicks: 0, loopEndTicks: 0 }).refusal,
		).toBe("empty_loop");
		// Bars 9-11 hold nothing: the fixture's placements are in bars 1-2.
		expect(
			buildOutline({
				...base,
				loopStartTicks: bars(8),
				loopEndTicks: bars(10),
			}).refusal,
		).toBe("no_placements_in_loop");
	});

	it("refuses an outline that would run past the guaranteed arrangement bound", () => {
		const fixture = createCommandTestProject();
		const result = buildOutline({
			project: fixture.project,
			template: AABA,
			mode: "linked",
			loopStartTicks: 0,
			loopEndTicks: bars(2),
			// Deep inside the ten-minute bound, so the 32-bar template overruns it.
			startTicks: 100_000_000,
			ids: createSeededIdFactory("bound"),
		});

		expect(result.refusal).toBe("exceeds_arrangement_bound");
		expect(result.commands).toEqual([]);
	});

	it("selects a loop range by placement start, not by overlap", () => {
		const fixture = createCommandTestProject();
		// Bar 1 only: placement A starts there, placement B (bar 2) does not.
		expect(placementsInRange(fixture.project, 0, bars(1))).toHaveLength(1);
		expect(placementsInRange(fixture.project, 0, bars(2))).toHaveLength(2);
	});

	it("survives save and reload", async () => {
		const { parseProject, serializeProject } = await import("../domain");
		const { history, result } = run("independent");
		history.execute(result.commands);

		const reloaded = parseProject(
			JSON.parse(JSON.stringify(serializeProject(history.project))),
		);

		expect(reloaded.ok, reloaded.ok ? "" : reloaded.issues[0]?.message).toBe(
			true,
		);
		if (!reloaded.ok) return;
		expect(reloaded.value.song.sections).toEqual(history.project.song.sections);
		expect(reloaded.value.song.placements).toEqual(
			history.project.song.placements,
		);
	});
});
