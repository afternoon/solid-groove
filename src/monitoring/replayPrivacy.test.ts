// ADR 0002 decision 2, second half: "Anything rendering user-authored or
// project-derived content is additionally marked with Sentry's block/mask class
// or attribute at the component level, so a new surface is masked by the
// default *and* by its own markup."
//
// That sentence is only worth anything if something checks it. The global
// `maskAllText` default lives in one file and can be weakened from a distance —
// by an SDK upgrade, by an unmask selector added to make a replay readable, by
// a future decision to relax it for a specific surface. The component-level
// marking is the safeguard that survives all three, and this file is what stops
// it silently rotting as surfaces are added and moved.
//
// It reads the source rather than rendering the components, deliberately: the
// question is a structural one about the codebase ("does this surface carry its
// marking?"), the answer must cover surfaces a later task adds, and rendering
// each of these panels needs a project fixture, an audio runtime, and a router.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_CONTENT, MASK_CONTENT, UNMASK_CONTENT } from "./replayPrivacy";

const sourceRoot = join(process.cwd(), "src");

function read(relative: string): string {
	return readFileSync(join(sourceRoot, relative), "utf8");
}

/**
 * Every surface that renders user-authored or project-derived content, with
 * the anchor its marking sits on.
 *
 * `anchor` is a string that appears in the source *on the marked element*, so a
 * failure names the element rather than just the file. Adding a panel that
 * shows a track, clip, project, or asset name — or that accepts typed text —
 * means adding it here. A reviewer who sees a new content surface and no new
 * row in this table has found the gap this table exists to surface.
 */
const CONTENT_SURFACES: readonly {
	readonly file: string;
	readonly anchor: string;
	readonly renders: string;
	readonly marking: string;
}[] = [
	{
		file: "components/ProjectList.tsx",
		anchor: "project-card",
		renders: "project names, the rename input, and the delete confirmation",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/EditorHeader.tsx",
		anchor: "project-name",
		renders: "the open project's name",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/Mixer.tsx",
		anchor: "mixer-strip",
		renders: "the track name input and every aria-label built from it",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/TrackEditor.tsx",
		anchor: "track-name",
		renders: "the selected track's name",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/EditorView.tsx",
		anchor: "track-name",
		renders: "the drum track's name",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/StepEditor.tsx",
		anchor: "step-lane",
		renders: "per-lane pad and asset names",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/PianoRoll.tsx",
		anchor: "piano-roll",
		renders: "the clip's name and the user's notes as DOM",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/DrumMachinePanel.tsx",
		anchor: "pad-sample",
		renders: "every asset name a pad can load",
		marking: MASK_CONTENT,
	},
	{
		file: "editor/LoopInfo.tsx",
		anchor: "loop-asset",
		renders: "the loop asset this project resolved to",
		marking: MASK_CONTENT,
	},
	{
		file: "instrument/SamplerPanel.tsx",
		anchor: "instrument-panel-group",
		renders: "the loaded sample's name and the replacement picker",
		marking: MASK_CONTENT,
	},
	{
		file: "arrangement/ArrangementView.tsx",
		anchor: "arrangement-headers",
		renders: "track names in the arrangement's header column",
		marking: MASK_CONTENT,
	},
	{
		file: "arrangement/ArrangementView.tsx",
		anchor: "arrangement-canvas-stack",
		renders: "clip names and waveforms as pixels",
		marking: BLOCK_CONTENT,
	},
	{
		file: "library/LibraryBrowser.tsx",
		anchor: "library-search",
		renders: "the sound search the user typed",
		marking: MASK_CONTENT,
	},
	{
		file: "library/LibraryFacets.tsx",
		anchor: "library-search",
		renders: "the sound search the user typed",
		marking: MASK_CONTENT,
	},
	{
		file: "library/PackList.tsx",
		anchor: "pack-browser-search",
		renders: "the pack search the user typed",
		marking: MASK_CONTENT,
	},
];

describe("component-level replay marking (ADR 0002 decision 2)", () => {
	for (const surface of CONTENT_SURFACES) {
		it(`marks ${surface.anchor} in ${surface.file}, which renders ${surface.renders}`, () => {
			const source = read(surface.file);
			// The marking is interpolated onto the same `class` expression as the
			// anchor, so this matches the element rather than merely the file.
			const marked = new RegExp(
				`${surface.anchor}[^"\`]*\\$\\{${surface.marking === MASK_CONTENT ? "MASK_CONTENT" : "BLOCK_CONTENT"}\\}`,
			);
			expect(
				marked.test(source),
				`"${surface.anchor}" in ${surface.file} renders ${surface.renders} ` +
					`but does not carry ${surface.marking}. ADR 0002 decision 2 requires ` +
					"content surfaces to be masked by their own markup as well as by the " +
					"global default.",
			).toBe(true);
		});
	}

	it("imports the marking from this module rather than writing the class inline", () => {
		// A hand-written "sentry-mask" string would not be found by a rename and
		// would not be found by the check above either.
		for (const file of new Set(CONTENT_SURFACES.map((s) => s.file))) {
			expect(read(file), `${file} should import its marking`).toContain(
				'from "../monitoring/replayPrivacy"',
			);
		}
	});
});

describe("nothing unmasks itself (ADR 0002 decision 2)", () => {
	it("exposes the mask and block classes Sentry looks for by default", () => {
		// Named as strings rather than imported from the SDK, so `sentrySink.ts`
		// stays the only module importing `@sentry/*` (ADR 0001 decision 1).
		expect(MASK_CONTENT).toBe("sentry-mask");
		expect(BLOCK_CONTENT).toBe("sentry-block");
	});

	it("has no component that unmasks itself", () => {
		// Unmasking is permitted only for stable, non-user-authored chrome, and
		// only by an explicit named selector in the SDK configuration — never by a
		// component deciding for itself that its own content is safe to record.
		const offenders: string[] = [];
		for (const file of new Set(CONTENT_SURFACES.map((s) => s.file))) {
			if (read(file).includes(UNMASK_CONTENT)) offenders.push(file);
		}
		expect(offenders).toEqual([]);
	});
});
