/**
 * The arrangement's section-editing controller (`ARR-003`; PRD ARR-02, ARR-03).
 *
 * Framework-free, like `placementEditingController.ts` beside it: it turns
 * "add a section here", "rename this one", "move it earlier", "build an outline
 * from the loop" into the commands from `src/commands/definitions/sections.ts`
 * and the pure builder in `arrangementOutline.ts`, and hands them to the
 * `dispatch` the editor session supplies. It never mutates a project.
 *
 * ## The analytics live here, not in the UI
 * ARR-003's OPS-02 obligations are emitted from this one place, so a second
 * surface reaching the same operation cannot double-count or miss:
 * `section_created` (once per created section, `origin` naming which affordance
 * made it), the `sections` `feature_first_use` key (on the first section
 * operation of any kind), and
 * `arrangement_milestone` — the PRD section 11 primary measure, the first time a
 * project reaches at least three *named* sections and two minutes. The milestone
 * is keyed by project ID through `logOnce`, so it fires exactly once per project
 * however many further edits land, and it is re-evaluated after every landed
 * transaction rather than only after a section edit, because a project can cross
 * the two-minute line by dragging a clip.
 *
 * Every event fires only *after* its transaction landed, so a rejected edit logs
 * nothing. No parameter carries a section name, a project name, or any other
 * user text (PRD OPS-02): `origin` and `template_id` are closed value sets,
 * `section_count` is a clamped count, and the duration is a bucket label.
 */

import type { Analytics } from "../analytics/analytics";
import { bucketOf } from "../analytics/buckets";
import {
	addSection,
	reorderSection,
	updateSection,
} from "../commands/definitions/sections";
import type { RawCommandInput } from "../commands/types";
import type { Project, Section } from "../domain/entities";
import type { IdFactory, SectionId } from "../domain/ids";
import { TICKS_PER_BAR, ticksToSeconds, toTicks } from "../domain/time";
import { clampTick, snapToBar } from "./placementGeometry";

/** Where a created section came from, as `section_created`'s `origin`. */
export type SectionOrigin = "manual" | "template" | "assistant";

/** The PRD section 11 milestone: three named sections and two minutes. */
export const MILESTONE_SECTION_COUNT = 3;
export const MILESTONE_SECONDS = 120;

export interface SectionEditingOptions {
	readonly getProject: () => Project | null;
	/** Applies commands as one transaction; returns whether anything landed. */
	readonly dispatch: (commands: readonly RawCommandInput[]) => boolean;
	readonly ids: IdFactory;
	readonly analytics?: Analytics;
	readonly onChange?: () => void;
}

/** The default palette a new section cycles through, so two adjacent sections
 * are visually distinguishable without asking the user to pick a color first. */
const SECTION_COLORS = [
	"#6366f1",
	"#ec4899",
	"#f59e0b",
	"#10b981",
	"#06b6d4",
	"#8b5cf6",
];

/** How long the arrangement is, in seconds at the song's tempo. */
export function arrangementSeconds(project: Project): number {
	const ends = [
		...project.song.sections.map((s) => s.startTicks + s.durationTicks),
		...project.song.placements.map((p) => p.startTicks + p.durationTicks),
		0,
	];
	return ticksToSeconds(Math.max(...ends), project.song.tempo);
}

/** Sections with a non-blank name — what the milestone counts. */
export function namedSections(project: Project): readonly Section[] {
	return project.song.sections.filter(
		(section) => section.name.trim().length > 0,
	);
}

export function createSectionEditing(options: SectionEditingOptions) {
	let firstUseLogged = false;

	function project(): Project | null {
		return options.getProject();
	}

	function analytics(): Analytics | undefined {
		return options.analytics;
	}

	/** One section interaction: the once-per-account `sections` first use. */
	function noteFirstUse(): void {
		if (firstUseLogged) return;
		firstUseLogged = analytics()?.logFeatureFirstUse("sections") ?? true;
	}

	/** The PRD section 11 primary measure; at most once per project. */
	function checkMilestone(): void {
		const current = project();
		if (!current) return;
		const sections = namedSections(current);
		if (sections.length < MILESTONE_SECTION_COUNT) return;
		const seconds = arrangementSeconds(current);
		if (seconds < MILESTONE_SECONDS) return;
		analytics()?.logOnce(
			`arrangement_milestone:${current.metadata.id}`,
			"arrangement_milestone",
			{
				section_count: sections.length,
				// A bucket, never a raw duration: the 2-minute threshold is an exact
				// bucket edge (`musical_duration`), so the report reads the primary
				// measure directly.
				duration_bucket: bucketOf("musical_duration", seconds),
			},
		);
	}

	function run(commands: readonly RawCommandInput[]): boolean {
		if (commands.length === 0) return false;
		if (!options.dispatch(commands)) return false;
		options.onChange?.();
		return true;
	}

	/** Add one section at a bar-snapped tick (ARR-02's "add"). */
	function add(
		startTicks: number,
		durationBars = 4,
		name = "Section",
		origin: SectionOrigin = "manual",
	): boolean {
		const current = project();
		if (!current) return false;
		const section: Section = {
			id: options.ids("section"),
			name,
			color:
				SECTION_COLORS[current.song.sections.length % SECTION_COLORS.length],
			startTicks: snapToBar(clampTick(startTicks)),
			durationTicks: toTicks(Math.max(1, durationBars) * TICKS_PER_BAR),
		};
		if (!run([addSection(section)])) return false;
		noteFirstUse();
		analytics()?.log("section_created", { origin });
		checkMilestone();
		return true;
	}

	/** One landed edit: first use, then re-check the milestone. */
	function edited(command: RawCommandInput): boolean {
		if (!run([command])) return false;
		noteFirstUse();
		checkMilestone();
		return true;
	}

	/** A blank name is refused rather than stored — the milestone counts named
	 * sections, and an unnamed one is not a structure decision the user made. */
	const rename = (sectionId: SectionId, name: string): boolean =>
		name.trim().length === 0
			? false
			: edited(updateSection(sectionId, { name: name.trim() }));

	const resize = (sectionId: SectionId, durationBars: number): boolean =>
		edited(
			updateSection(sectionId, {
				durationTicks: toTicks(Math.max(1, durationBars) * TICKS_PER_BAR),
			}),
		);

	const recolor = (sectionId: SectionId, color: string): boolean =>
		edited(updateSection(sectionId, { color }));

	/** ARR-02's reorder: one transaction that carries the contained clips. */
	const reorder = (sectionId: SectionId, toIndex: number): boolean =>
		edited(reorderSection(sectionId, toIndex));

	return {
		add,
		rename,
		resize,
		recolor,
		reorder,
		/** Re-evaluate the milestone after a transaction this controller did not
		 * run — a clip drag can push a project past two minutes on its own. */
		checkMilestone,
	};
}

export type SectionEditing = ReturnType<typeof createSectionEditing>;
