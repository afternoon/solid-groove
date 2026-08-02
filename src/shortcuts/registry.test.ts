import { describe, expect, it } from "vitest";
import {
	type ChordEvent,
	matchesChord,
	parseChord,
	type ShortcutPlatform,
} from "./keys";
import {
	chordsFor,
	matchShortcut,
	RESERVED_CHORDS,
	resolveContexts,
	SHORTCUT_ACTION_IDS,
	SHORTCUTS,
	shortcutById,
	shortcutLabel,
	shortcutSections,
	shortcutsInContext,
} from "./registry";
import type { ShortcutContext } from "./types";
import { SHORTCUT_CONTEXTS, SHORTCUT_GROUPS } from "./types";

const PLATFORMS: readonly ShortcutPlatform[] = ["mac", "other"];

/** The event a chord would produce on the given platform. */
function chordEvent(
	chord: {
		key: string;
		mod: boolean;
		ctrl: boolean;
		alt: boolean;
		shift: boolean;
	},
	platform: ShortcutPlatform,
): ChordEvent {
	return {
		key: chord.key,
		metaKey: platform === "mac" ? chord.mod : false,
		ctrlKey: platform === "mac" ? chord.ctrl : chord.mod,
		altKey: chord.alt,
		shiftKey: chord.shift,
	};
}

describe("registry shape", () => {
	it("has exactly one definition per pinned action ID", () => {
		expect(SHORTCUTS.map((shortcut) => shortcut.id).sort()).toEqual(
			[...SHORTCUT_ACTION_IDS].sort(),
		);
	});

	it("gives every entry keys, a group, a context, and an Ableton position", () => {
		for (const shortcut of SHORTCUTS) {
			expect(shortcut.keys.mac.length).toBeGreaterThan(0);
			expect(shortcut.keys.other.length).toBeGreaterThan(0);
			expect(SHORTCUT_GROUPS).toContain(shortcut.group);
			expect(shortcut.contexts.length).toBeGreaterThan(0);
			for (const context of shortcut.contexts) {
				expect(SHORTCUT_CONTEXTS).toContain(context);
			}
			if (shortcut.ableton.kind === "differs") {
				// A deviation is only documented if it says what it deviates from.
				expect(shortcut.ableton.abletonKeys.length).toBeGreaterThan(0);
				expect(shortcut.ableton.reason.length).toBeGreaterThan(0);
			}
		}
	});

	it("parses every declared key on both platforms", () => {
		for (const shortcut of SHORTCUTS) {
			for (const platform of PLATFORMS) {
				expect(chordsFor(shortcut, platform).length).toBeGreaterThan(0);
			}
		}
	});

	it("encodes the PRD KEY-01 mapping table", () => {
		expect(shortcutLabel("transport.play_stop", "mac")).toBe("Space");
		expect(shortcutLabel("transport.continue", "other")).toBe("Shift+Space");
		expect(shortcutLabel("edit.undo", "mac")).toBe("Cmd+Z");
		expect(shortcutLabel("edit.undo", "other")).toBe("Ctrl+Z");
		expect(shortcutLabel("edit.redo", "mac")).toBe("Cmd+Shift+Z");
		expect(shortcutLabel("edit.redo", "other")).toBe("Ctrl+Y");
		expect(shortcutLabel("edit.duplicate", "other")).toBe("Ctrl+D");
		expect(shortcutLabel("arrangement.split_clip", "mac")).toBe("E");
		expect(shortcutLabel("clip.quantize", "mac")).toBe("Q");
		expect(shortcutLabel("arrangement.toggle_loop", "mac")).toBe("L");
		expect(shortcutLabel("clip.toggle_draw_mode", "mac")).toBe("B");
		expect(shortcutLabel("arrangement.toggle_automation_view", "mac")).toBe(
			"A",
		);
		expect(shortcutLabel("view.zoom_to_selection", "mac")).toBe("Z");
		expect(shortcutLabel("view.zoom_back", "mac")).toBe("X");
		expect(shortcutLabel("view.zoom_in", "mac")).toBe("+");
		expect(shortcutLabel("view.zoom_out", "mac")).toBe("-");
		expect(shortcutLabel("transport.metronome", "mac")).toBe("O");
		expect(shortcutLabel("view.close_surface", "mac")).toBe("Escape");
		expect(shortcutLabel("help.shortcut_guide", "mac")).toBe("?");
	});

	it("records the browser-safe deviations from Live as deviations", () => {
		for (const id of [
			"arrangement.split_clip",
			"arrangement.toggle_loop",
			"clip.quantize",
		] as const) {
			expect(shortcutById(id).ableton.kind).toBe("differs");
		}
		expect(shortcutById("transport.play_stop").ableton.kind).toBe("follows");
		expect(shortcutById("help.shortcut_guide").ableton.kind).toBe(
			"solid_groove",
		);
	});
});

describe("conflict rules", () => {
	it("claims no browser- or OS-reserved combination", () => {
		for (const platform of PLATFORMS) {
			const reserved = RESERVED_CHORDS.map((spec) =>
				parseChord(spec, platform),
			);
			for (const shortcut of SHORTCUTS) {
				for (const chord of chordsFor(shortcut, platform)) {
					const clash = reserved.find((other) =>
						matchesChord(other, chordEvent(chord, platform), platform),
					);
					expect(
						clash,
						`${shortcut.id} claims reserved ${JSON.stringify(chord)}`,
					).toBeUndefined();
				}
			}
		}
	});

	it("documents every cancellable browser combination it does take over", () => {
		// Cmd/Ctrl+D bookmarks the page. The PRD mapping wins, but only with the
		// override written down.
		expect(shortcutById("edit.duplicate").browserConflict?.note).toMatch(
			/bookmark/i,
		);
	});

	/** Every shortcut another one in the same active set would also match. */
	function ambiguousIn(
		active: readonly ShortcutContext[],
		platform: ShortcutPlatform,
	): string[] {
		const eligible = shortcutsInContext(active);
		const clashes: string[] = [];
		for (const shortcut of eligible) {
			for (const chord of chordsFor(shortcut, platform)) {
				const matches = eligible.filter((other) =>
					chordsFor(other, platform).some((otherChord) =>
						matchesChord(otherChord, chordEvent(chord, platform), platform),
					),
				);
				if (matches.length > 1) {
					clashes.push(matches.map((match) => match.id).join(" vs "));
				}
			}
		}
		return clashes;
	}

	it("never lets two shortcuts match the same event in one context", () => {
		for (const platform of PLATFORMS) {
			for (const context of SHORTCUT_CONTEXTS) {
				expect(
					ambiguousIn([context], platform),
					`ambiguous in ${context} on ${platform}`,
				).toEqual([]);
			}
		}
	});

	// A real surface activates a *set* of contexts, not one: `EditorView` runs
	// `["editor", "step_editor"]`. Checking single contexts would let two
	// mappings that are individually unambiguous collide once both their
	// surfaces are on screen together, so every pair is checked too.
	it("never lets two shortcuts match the same event in any pair of contexts", () => {
		for (const platform of PLATFORMS) {
			for (const first of SHORTCUT_CONTEXTS) {
				for (const second of SHORTCUT_CONTEXTS) {
					if (first === second) continue;
					expect(
						ambiguousIn([first, second], platform),
						`ambiguous in ${first}+${second} on ${platform}`,
					).toEqual([]);
				}
			}
		}
	});

	// The context sets surfaces actually activate today. Pairs cover these, but
	// naming them keeps the guarantee attached to real screens as sets grow past
	// two contexts.
	it("never lets two shortcuts match the same event in a live surface's context set", () => {
		const LIVE_CONTEXT_SETS: readonly (readonly ShortcutContext[])[] = [
			["editor", "step_editor"],
			["editor", "step_editor", "selection"],
			["editor", "arrangement", "timeline", "selection"],
			["editor", "piano_roll", "timeline", "selection"],
			["editor", "automation_lane", "timeline", "selection"],
			["dialog"],
			["editor", "gesture"],
		];
		for (const platform of PLATFORMS) {
			for (const active of LIVE_CONTEXT_SETS) {
				expect(
					ambiguousIn(active, platform),
					`ambiguous in ${active.join("+")} on ${platform}`,
				).toEqual([]);
			}
		}
	});
});

describe("context resolution", () => {
	it("always includes global", () => {
		expect(resolveContexts([])).toEqual(["global"]);
		expect(resolveContexts(["editor"])).toEqual(["global", "editor"]);
	});

	it("suppresses every other context while a dialog is active", () => {
		expect(resolveContexts(["dialog", "editor"])).toEqual(["dialog"]);
		const inDialog = shortcutsInContext(["dialog", "editor", "selection"]);
		expect(inDialog.map((shortcut) => shortcut.id)).toEqual([
			"view.close_surface",
		]);
	});

	it("has at least one shortcut registered in every declared context", () => {
		for (const context of SHORTCUT_CONTEXTS) {
			const registered = SHORTCUTS.filter((shortcut) =>
				shortcut.contexts.includes(context),
			);
			expect(registered.length, `no shortcut in ${context}`).toBeGreaterThan(0);
		}
	});

	it("dispatches the right action in every declared context", () => {
		const expected: Record<
			ShortcutContext,
			{ key: string; mod?: boolean; id: string }
		> = {
			global: { key: "z", mod: true, id: "edit.undo" },
			editor: { key: " ", id: "transport.play_stop" },
			arrangement: { key: "e", id: "arrangement.split_clip" },
			step_editor: { key: "q", id: "clip.quantize" },
			piano_roll: { key: "q", id: "clip.quantize" },
			automation_lane: { key: "b", id: "clip.toggle_draw_mode" },
			timeline: { key: "+", id: "view.zoom_in" },
			selection: { key: "x", mod: true, id: "edit.cut" },
			dialog: { key: "escape", id: "view.close_surface" },
			gesture: { key: "escape", id: "view.close_surface" },
		};
		for (const context of SHORTCUT_CONTEXTS) {
			const probe = expected[context];
			const match = matchShortcut(
				{
					key: probe.key,
					metaKey: false,
					ctrlKey: probe.mod === true,
					altKey: false,
					shiftKey: false,
				},
				"other",
				[context],
			);
			expect(match?.id, `no dispatch in ${context}`).toBe(probe.id);
		}
	});

	it("does not fire an arrangement shortcut from the step editor", () => {
		expect(
			matchShortcut(
				{
					key: "e",
					metaKey: false,
					ctrlKey: false,
					altKey: false,
					shiftKey: false,
				},
				"other",
				["step_editor"],
			),
		).toBeUndefined();
	});
});

describe("guide sections", () => {
	it("groups in PRD KEY-02 order and drops groups with no shortcuts yet", () => {
		const sections = shortcutSections();
		expect(sections.map((section) => section.group)).toEqual([
			"transport",
			"global_editing",
			"arrangement",
			"clips_notes",
			"automation",
			"navigation",
		]);
		expect(sections.every((section) => section.shortcuts.length > 0)).toBe(
			true,
		);
	});

	it("puts every shortcut into exactly one section", () => {
		const grouped = shortcutSections().flatMap((section) => section.shortcuts);
		expect(grouped).toHaveLength(SHORTCUTS.length);
	});
});
