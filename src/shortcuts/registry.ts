// The one typed shortcut registry (PRD `KEY-01`).
//
// This file is the *only* place a Solid Groove key combination is written
// down. Event handling (`ShortcutController`), tooltips and menu labels
// (`shortcutLabel`), the `?` mapping guide (`ShortcutGuide.tsx`), the analytics
// `action_id` set, and `docs/shortcuts.md` are all generated from these
// entries, so a mapping cannot be changed in one surface and stale in another.
//
// ## What an entry declares
//
// Action ID, per-platform keys, valid contexts, the group it appears under in
// the guide, and whether it follows or intentionally differs from Ableton Live
// 12 — the `KEY-01` baseline. Enabled state is *not* declared here: it belongs
// to the surface that owns the action and is supplied per handler, because
// whether Undo is available is a property of the session, not of the mapping.
//
// ## Actions with no handler yet
//
// Every mapping in the PRD `KEY-01` table is registered, including ones whose
// surface lands in a later Phase 1 or Phase 2 task. An action nobody has
// registered a handler for simply does not fire — it is listed in the guide,
// where it is shown as unavailable, rather than being invented twice later.
//
// ## Remapping
//
// P0 mappings are read-only (`KEY-02`). Entries are keyed by a stable action ID
// and resolved through lookups rather than by array position, so a P1
// user-remapping layer can override `keys` per action without this file or its
// consumers changing shape.

import {
	type ChordEvent,
	chordLabel,
	type KeyChord,
	matchesChord,
	parseChord,
	type ShortcutPlatform,
} from "./keys";
import type {
	AbletonParity,
	BrowserConflict,
	ShortcutContext,
	ShortcutGroup,
} from "./types";
import { AMBIENT_CONTEXT, MODAL_CONTEXT, SHORTCUT_GROUPS } from "./types";

/**
 * Every action a shortcut can invoke.
 *
 * Pinned as a tuple so it is a closed type: `shortcut_used`'s `action_id`
 * parameter in the analytics catalog is checked against this list, and a
 * handler for an unregistered action is a compile error.
 */
export const SHORTCUT_ACTION_IDS = [
	"transport.play_stop",
	"transport.continue",
	"transport.metronome",
	"edit.undo",
	"edit.redo",
	"edit.cut",
	"edit.copy",
	"edit.paste",
	"edit.select_all",
	"edit.delete",
	"edit.duplicate",
	"arrangement.split_clip",
	"arrangement.toggle_loop",
	"arrangement.toggle_automation_view",
	"clip.quantize",
	"clip.toggle_draw_mode",
	"view.zoom_to_selection",
	"view.zoom_back",
	"view.zoom_in",
	"view.zoom_out",
	"view.close_surface",
	"help.shortcut_guide",
] as const;
export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

/** Per-platform key combinations for one action. */
export interface ShortcutKeys {
	readonly mac: readonly string[];
	readonly other: readonly string[];
}

export interface ShortcutDefinition {
	readonly id: ShortcutActionId;
	/** Menu/tooltip/guide wording. Never a user-entered string. */
	readonly label: string;
	/** One line of guide detail: what the action does, in context. */
	readonly description: string;
	readonly group: ShortcutGroup;
	/** Any one of these being active makes the shortcut eligible. */
	readonly contexts: readonly ShortcutContext[];
	readonly keys: ShortcutKeys;
	readonly ableton: AbletonParity;
	/**
	 * `allowed` lets the shortcut through a focused input, textarea, or
	 * content-editable element. Everything else is blocked there so typing
	 * behaves normally (`KEY-01`).
	 */
	readonly textEntry?: "allowed";
	/** Auto-repeat fires the action again. Off unless holding the key is the point. */
	readonly repeatable?: boolean;
	/** Set false where the browser default must survive. */
	readonly preventDefault?: boolean;
	readonly browserConflict?: BrowserConflict;
}

type KeysInput = string | readonly string[] | ShortcutKeys;

function toKeys(input: KeysInput): ShortcutKeys {
	if (typeof input === "string") return { mac: [input], other: [input] };
	if (Array.isArray(input)) {
		const specs = input as readonly string[];
		return { mac: specs, other: specs };
	}
	return input as ShortcutKeys;
}

function define(
	definition: Omit<ShortcutDefinition, "keys"> & { readonly keys: KeysInput },
): ShortcutDefinition {
	return { ...definition, keys: toKeys(definition.keys) };
}

/**
 * The PRD `KEY-01` initial mapping, in guide order.
 *
 * The Ableton-derived mappings and documented deviations use the Ableton Live
 * 12 keyboard shortcut reference as their baseline:
 * https://www.ableton.com/en/manual/live-keyboard-shortcuts/
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
	define({
		id: "transport.play_stop",
		label: "Play/stop",
		description: "Starts playback from the start point, or stops it.",
		group: "transport",
		contexts: ["editor"],
		keys: "Space",
		ableton: { kind: "follows", abletonKeys: "Space" },
	}),
	define({
		id: "transport.continue",
		label: "Continue from stop position",
		description: "Resumes playback from where it last stopped.",
		group: "transport",
		contexts: ["editor"],
		keys: "Shift+Space",
		ableton: { kind: "follows", abletonKeys: "Shift+Space" },
	}),
	define({
		id: "transport.metronome",
		label: "Toggle metronome",
		description: "Turns the click on or off without stopping playback.",
		group: "transport",
		contexts: ["editor"],
		keys: "O",
		ableton: {
			kind: "solid_groove",
			reason:
				"No single-key Live equivalent is claimed; O is unassigned in Solid Groove and free in the browser.",
		},
	}),
	define({
		id: "edit.undo",
		label: "Undo",
		description: "Reverts the last edit in this editing session.",
		group: "global_editing",
		contexts: ["global"],
		keys: "Mod+Z",
		ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+Z" },
	}),
	define({
		id: "edit.redo",
		label: "Redo",
		description: "Reapplies the last undone edit.",
		group: "global_editing",
		contexts: ["global"],
		keys: { mac: ["Mod+Shift+Z"], other: ["Mod+Y", "Mod+Shift+Z"] },
		ableton: { kind: "follows", abletonKeys: "Cmd+Shift+Z / Ctrl+Y" },
	}),
	define({
		id: "edit.cut",
		label: "Cut",
		description: "Cuts the current selection to the clipboard.",
		group: "global_editing",
		contexts: ["selection"],
		keys: "Mod+X",
		ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+X" },
	}),
	define({
		id: "edit.copy",
		label: "Copy",
		description: "Copies the current selection to the clipboard.",
		group: "global_editing",
		contexts: ["selection"],
		keys: "Mod+C",
		ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+C" },
	}),
	define({
		id: "edit.paste",
		label: "Paste",
		description: "Pastes the clipboard into the current selection scope.",
		group: "global_editing",
		contexts: ["selection"],
		keys: "Mod+V",
		ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+V" },
	}),
	define({
		id: "edit.select_all",
		label: "Select all",
		description: "Selects everything in the current selection scope.",
		group: "global_editing",
		contexts: ["selection"],
		keys: "Mod+A",
		ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+A" },
	}),
	define({
		id: "edit.delete",
		label: "Delete selection",
		description: "Deletes the selected notes, clips, or placements.",
		group: "global_editing",
		contexts: ["arrangement", "step_editor", "piano_roll", "automation_lane"],
		keys: ["Delete", "Backspace"],
		ableton: { kind: "follows", abletonKeys: "Delete / Backspace" },
	}),
	define({
		id: "edit.duplicate",
		label: "Duplicate selection",
		description:
			"Duplicates the selected tracks, clips, placements, notes, sections, automation points, or devices.",
		group: "global_editing",
		contexts: ["selection"],
		keys: "Mod+D",
		ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+D" },
		browserConflict: {
			keys: "Cmd/Ctrl+D",
			note: "Bookmarks the page in most browsers. Solid Groove cancels the default while an editor selection exists, matching Live.",
		},
	}),
	define({
		id: "arrangement.split_clip",
		label: "Split clip",
		description: "Splits the selected clip at the selection or playhead.",
		group: "arrangement",
		contexts: ["arrangement"],
		keys: "E",
		ableton: {
			kind: "differs",
			abletonKeys: "Cmd/Ctrl+E",
			reason:
				"Cmd/Ctrl+E is taken by browser search/address-bar behavior, so the modifier is dropped rather than intercepted.",
		},
	}),
	define({
		id: "arrangement.toggle_loop",
		label: "Toggle arrangement loop",
		description: "Turns the arrangement loop on or off over the selection.",
		group: "arrangement",
		contexts: ["arrangement"],
		keys: "L",
		ableton: {
			kind: "differs",
			abletonKeys: "Cmd/Ctrl+L",
			reason:
				"Cmd/Ctrl+L focuses the browser address bar and cannot be reclaimed, so the modifier is dropped.",
		},
	}),
	define({
		id: "arrangement.toggle_automation_view",
		label: "Toggle automation view",
		description: "Shows or hides automation lanes in the arrangement.",
		group: "automation",
		contexts: ["arrangement"],
		keys: "A",
		ableton: { kind: "follows", abletonKeys: "A" },
	}),
	define({
		id: "clip.quantize",
		label: "Quantize selected notes",
		description: "Snaps the selected notes to the current quantization grid.",
		group: "clips_notes",
		contexts: ["step_editor", "piano_roll"],
		keys: "Q",
		ableton: {
			kind: "differs",
			abletonKeys: "Cmd/Ctrl+U",
			reason:
				"Cmd/Ctrl+U is view-source on Windows/Linux browsers, so the modifier is dropped.",
		},
	}),
	define({
		id: "clip.toggle_draw_mode",
		label: "Toggle draw mode",
		description: "Switches between drawing and selecting in a detail editor.",
		group: "clips_notes",
		contexts: ["step_editor", "piano_roll", "automation_lane"],
		keys: "B",
		ableton: { kind: "follows", abletonKeys: "B" },
	}),
	define({
		id: "view.zoom_to_selection",
		label: "Zoom to selection",
		description: "Zooms the timeline to the current selection.",
		group: "navigation",
		contexts: ["arrangement", "step_editor", "piano_roll", "automation_lane"],
		keys: "Z",
		ableton: { kind: "follows", abletonKeys: "Z" },
	}),
	define({
		id: "view.zoom_back",
		label: "Zoom back",
		description: "Returns to the zoom level before the last zoom to selection.",
		group: "navigation",
		contexts: ["arrangement", "step_editor", "piano_roll", "automation_lane"],
		keys: "X",
		ableton: { kind: "follows", abletonKeys: "X" },
	}),
	define({
		id: "view.zoom_in",
		label: "Zoom in",
		description: "Zooms the focused timeline or editor in.",
		group: "navigation",
		contexts: [
			"timeline",
			"arrangement",
			"step_editor",
			"piano_roll",
			"automation_lane",
		],
		keys: "+",
		repeatable: true,
		ableton: { kind: "follows", abletonKeys: "+" },
	}),
	define({
		id: "view.zoom_out",
		label: "Zoom out",
		description: "Zooms the focused timeline or editor out.",
		group: "navigation",
		contexts: [
			"timeline",
			"arrangement",
			"step_editor",
			"piano_roll",
			"automation_lane",
		],
		keys: "-",
		repeatable: true,
		ableton: { kind: "follows", abletonKeys: "-" },
	}),
	define({
		id: "view.close_surface",
		label: "Close or cancel",
		description:
			"Closes the open dialog or popover, or cancels the active gesture or selection.",
		group: "navigation",
		contexts: ["global", "dialog", "gesture"],
		keys: "Escape",
		// A modal's own search field is text entry, and Escape has to close the
		// modal from inside it (`KEY-02`: "closes it from anywhere").
		textEntry: "allowed",
		ableton: { kind: "follows", abletonKeys: "Esc" },
	}),
	define({
		id: "help.shortcut_guide",
		label: "Open keyboard mapping guide",
		description: "Opens the searchable list of keyboard shortcuts.",
		group: "navigation",
		contexts: ["editor"],
		keys: "?",
		ableton: {
			kind: "solid_groove",
			reason:
				"Live has no in-app mapping guide; ? is the web convention for one.",
		},
	}),
];

/**
 * Combinations the browser or operating system keeps for itself. A page cannot
 * reliably cancel these, so `KEY-01`'s "must not intercept browser- or
 * OS-reserved shortcuts merely for parity" is enforced as a registry test
 * rather than discovered by a user losing a tab.
 */
export const RESERVED_CHORDS: readonly string[] = [
	"Mod+T",
	"Mod+N",
	"Mod+W",
	"Mod+Q",
	"Mod+Shift+T",
	"Mod+Shift+N",
	"Mod+Shift+W",
	"Mod+Tab",
	"Alt+Tab",
	"Mod+L",
	"Mod+E",
	"Mod+U",
	"F5",
	"F11",
	"F12",
];

const byId = new Map<ShortcutActionId, ShortcutDefinition>(
	SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]),
);

/** The definition for an action ID. */
export function shortcutById(id: ShortcutActionId): ShortcutDefinition {
	const found = byId.get(id);
	if (!found) throw new Error(`unregistered shortcut action: ${id}`);
	return found;
}

/** The key specs that apply to one platform. */
export function keySpecsFor(
	shortcut: ShortcutDefinition,
	platform: ShortcutPlatform,
): readonly string[] {
	return platform === "mac" ? shortcut.keys.mac : shortcut.keys.other;
}

const chordCache = new Map<string, readonly KeyChord[]>();

/** The parsed chords for one action on one platform. */
export function chordsFor(
	shortcut: ShortcutDefinition,
	platform: ShortcutPlatform,
): readonly KeyChord[] {
	const cacheKey = `${shortcut.id}:${platform}`;
	const cached = chordCache.get(cacheKey);
	if (cached) return cached;
	const chords = keySpecsFor(shortcut, platform).map((spec) =>
		parseChord(spec, platform),
	);
	chordCache.set(cacheKey, chords);
	return chords;
}

/**
 * The label a tooltip or menu item shows, e.g. `Cmd+Shift+Z`. Where an action
 * has more than one combination the first is canonical.
 */
export function shortcutLabel(
	id: ShortcutActionId,
	platform: ShortcutPlatform,
): string {
	const chords = chordsFor(shortcutById(id), platform);
	return chordLabel(chords[0], platform);
}

/** Every label for an action, for the guide's key column. */
export function shortcutLabels(
	shortcut: ShortcutDefinition,
	platform: ShortcutPlatform,
): readonly string[] {
	return chordsFor(shortcut, platform).map((chord) =>
		chordLabel(chord, platform),
	);
}

/**
 * Resolves an active context set.
 *
 * `global` is always active, and a modal suppresses everything else, so
 * "context resolution is deterministic" holds without every caller
 * remembering the rule.
 */
export function resolveContexts(
	active: readonly ShortcutContext[],
): readonly ShortcutContext[] {
	if (active.includes(MODAL_CONTEXT)) return [MODAL_CONTEXT];
	return active.includes(AMBIENT_CONTEXT)
		? active
		: [AMBIENT_CONTEXT, ...active];
}

/** Whether a shortcut is eligible in an already-resolved context set. */
export function isInContext(
	shortcut: ShortcutDefinition,
	resolved: readonly ShortcutContext[],
): boolean {
	return shortcut.contexts.some((context) => resolved.includes(context));
}

/** Every shortcut valid in the given contexts, in registry order. */
export function shortcutsInContext(
	active: readonly ShortcutContext[],
): readonly ShortcutDefinition[] {
	const resolved = resolveContexts(active);
	return SHORTCUTS.filter((shortcut) => isInContext(shortcut, resolved));
}

/**
 * The shortcut a key event invokes, or `undefined`.
 *
 * Registry order breaks a tie; `registry.test.ts` asserts no two shortcuts can
 * match the same event in overlapping contexts, so order never decides an
 * ambiguous case in practice.
 */
export function matchShortcut(
	event: ChordEvent,
	platform: ShortcutPlatform,
	active: readonly ShortcutContext[],
): ShortcutDefinition | undefined {
	const resolved = resolveContexts(active);
	return SHORTCUTS.find(
		(shortcut) =>
			isInContext(shortcut, resolved) &&
			chordsFor(shortcut, platform).some((chord) =>
				matchesChord(chord, event, platform),
			),
	);
}

export interface ShortcutSection {
	readonly group: ShortcutGroup;
	readonly shortcuts: readonly ShortcutDefinition[];
}

/** The registry grouped into the `KEY-02` guide sections, empty ones dropped. */
export function shortcutSections(
	shortcuts: readonly ShortcutDefinition[] = SHORTCUTS,
): readonly ShortcutSection[] {
	return SHORTCUT_GROUPS.map((group) => ({
		group,
		shortcuts: shortcuts.filter((shortcut) => shortcut.group === group),
	})).filter((section) => section.shortcuts.length > 0);
}
