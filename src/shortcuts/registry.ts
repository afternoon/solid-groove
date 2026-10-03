// The one typed shortcut registry (PRD `KEY-01`).
//
// This file is the *only* place a Groove key combination is written
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
// consumers changing shape. The one piece of derived state here — the parsed
// chord cache — is keyed by definition *identity* rather than by action ID, so
// an overridden entry cannot pick up the base mapping's stale parse.

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
import {
  AMBIENT_CONTEXT,
  FOCUS_CONTEXTS,
  MODAL_CONTEXT,
  MODAL_OWNED_CONTEXTS,
  OVERLAY_CONTEXTS,
  SHORTCUT_GROUPS,
} from "./types";

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
  "transport.toggle_loop",
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
  "view.zoom_to_arrangement",
  "view.scroll_to_playhead",
  "view.zoom_in",
  "view.zoom_out",
  "view.show_arrangement",
  "view.show_instrument",
  "view.show_mixer",
  "view.close_surface",
  "help.shortcut_guide",
  "device.move_earlier",
  "device.move_later",
  "track.move_left",
  "track.move_right",
  "arrangement.loop_move_earlier",
  "arrangement.loop_move_later",
  "arrangement.loop_shorten",
  "arrangement.loop_lengthen",
  "track.select_previous",
  "track.select_next",
  "note.move_up",
  "note.move_down",
  "note.octave_up",
  "note.octave_down",
  "note.move_earlier",
  "note.move_later",
  "note.shorten",
  "note.lengthen",
  "value.nudge_up",
  "value.nudge_down",
  "library.select_previous",
  "library.select_next",
  "library.audition",
  "library.insert",
  "library.like",
  "library.similar",
  "library.shuffle",
  "library.pick_1",
  "library.pick_2",
  "library.pick_3",
  "library.pick_4",
  "library.pick_5",
  "library.pick_6",
  "library.pick_7",
  "library.pick_8",
  "library.pick_9",
  "library.pick_all",
  "library.category_previous",
  "library.category_next",
  "library.family_previous",
  "library.family_next",
  "library.genre_menu",
  "library.loop_tempo",
  "library.all_sounds",
  "library.favourites",
  "library.browse_packs",
  "library.back",
  "library.search",
  "export.focus_previous",
  "export.focus_next",
  "export.extend_previous",
  "export.extend_next",
  "export.toggle_focused",
  "export.pick_all",
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

const LIBRARY_KEY_PARITY: AbletonParity = {
  kind: "solid_groove",
  reason:
    "Live's browser has no single-key equivalent; the library's own keys are Groove's.",
};

/** One key of the library modal (`LIB-010`), live only in the `library` context. */
function libraryKey(
  id: ShortcutActionId,
  label: string,
  description: string,
  keys: string,
  extra: Partial<ShortcutDefinition> = {},
): ShortcutDefinition {
  return define({
    id,
    label,
    description,
    keys,
    group: "browser",
    contexts: ["library"],
    ableton: LIBRARY_KEY_PARITY,
    ...extra,
  });
}

const EXPORT_KEY_PARITY: AbletonParity = {
  kind: "solid_groove",
  reason: "Live's export dialog has no track list; these are Groove's own list keys.",
};

/** One key of the Export dialog's track list (`EXP-004`), live in `export_tracks`. */
function exportKey(
  id: ShortcutActionId,
  label: string,
  description: string,
  keys: string | readonly string[],
): ShortcutDefinition {
  return define({
    id,
    label,
    description,
    keys,
    group: "browser",
    contexts: ["export_tracks"],
    ableton: EXPORT_KEY_PARITY,
  });
}

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
];

/** `1`-`9`: the nth category, or in Browse packs the nth pack. */
const LIBRARY_PICKS = ORDINALS.map((nth, i) =>
  libraryKey(
    `library.pick_${i + 1}` as ShortcutActionId,
    `Pick ${i + 1}`,
    `Picks the ${nth} category; in Browse packs, opens the ${nth} pack.`,
    String(i + 1),
  ),
);

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
        "No single-key Live equivalent is claimed; O is unassigned in Groove and free in the browser.",
    },
  }),
  define({
    id: "transport.toggle_loop",
    label: "Toggle loop",
    description:
      "Turns looping over the ruler's loop brace on or off; the brace stays put.",
    group: "transport",
    contexts: ["editor"],
    keys: "Shift+L",
    ableton: {
      kind: "solid_groove",
      reason:
        "No Live shortcut is claimed for the loop switch itself; Live's Cmd/Ctrl+L loops the selection, and the browser keeps that chord.",
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
    contexts: ["selection", "arrangement"],
    keys: "Mod+X",
    ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+X" },
  }),
  define({
    id: "edit.copy",
    label: "Copy",
    description: "Copies the current selection to the clipboard.",
    group: "global_editing",
    contexts: ["selection", "arrangement"],
    keys: "Mod+C",
    ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+C" },
  }),
  define({
    id: "edit.paste",
    label: "Paste",
    description: "Pastes the clipboard into the current selection scope.",
    group: "global_editing",
    contexts: ["selection", "arrangement"],
    keys: "Mod+V",
    ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+V" },
  }),
  define({
    id: "edit.select_all",
    label: "Select all",
    description: "Selects everything in the current selection scope.",
    group: "global_editing",
    contexts: ["selection", "arrangement", "step_editor"],
    keys: "Mod+A",
    ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+A" },
  }),
  define({
    id: "edit.delete",
    label: "Delete selection",
    description:
      "Deletes the selected notes, clips, or placements, or a track chosen on its header when nothing inside it is selected.",
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
    contexts: ["selection", "arrangement"],
    keys: "Mod+D",
    ableton: { kind: "follows", abletonKeys: "Cmd/Ctrl+D" },
    browserConflict: {
      keys: "Cmd/Ctrl+D",
      note: "Bookmarks the page in most browsers. Groove cancels the default while an editor selection exists, matching Live.",
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
    id: "view.zoom_to_arrangement",
    label: "Zoom to arrangement",
    description: "Zooms the arrangement out or in to frame the whole song.",
    group: "navigation",
    contexts: ["editor"],
    keys: "Shift+Z",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live has no single key that frames the whole set; Shift+Z widens Z (zoom to selection) to everything.",
    },
  }),
  define({
    id: "view.scroll_to_playhead",
    label: "Scroll to playhead",
    description: "Scrolls the arrangement so the playhead is in view.",
    group: "navigation",
    contexts: ["editor"],
    keys: "P",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live scrolls with its Follow switch (Cmd/Ctrl+Shift+F), which the browser and Groove's transport do not share; P is a one-shot jump instead.",
    },
  }),
  define({
    id: "view.zoom_in",
    label: "Zoom in",
    description: "Zooms the focused timeline or editor in.",
    group: "navigation",
    contexts: [
      "editor",
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
      "editor",
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
    id: "view.show_arrangement",
    label: "Show the arrangement",
    description: "Switches the editor to the arrangement.",
    group: "navigation",
    contexts: ["editor", "sequence_editor"],
    keys: "1",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live shows everything at once and has no view to switch to; 1/2/3 is the hardware idiom UI-001 borrows.",
    },
  }),
  define({
    id: "view.show_instrument",
    label: "Show the instrument",
    description: "Switches the editor to the selected track's instrument.",
    group: "navigation",
    contexts: ["editor", "sequence_editor"],
    keys: "2",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live shows everything at once and has no view to switch to; 1/2/3 is the hardware idiom UI-001 borrows.",
    },
  }),
  define({
    id: "view.show_mixer",
    label: "Show the mixer",
    description: "Switches the editor to the mixer.",
    group: "navigation",
    contexts: ["editor", "sequence_editor"],
    keys: "3",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live shows everything at once and has no view to switch to; 1/2/3 is the hardware idiom UI-001 borrows.",
    },
  }),
  define({
    id: "view.close_surface",
    label: "Close or cancel",
    description: "Closes the open dialog or popover, or cancels the active gesture.",
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
    // The library modal reuses this action for "list the library's keys".
    contexts: ["editor", "library"],
    keys: "?",
    ableton: {
      kind: "solid_groove",
      reason: "Live has no in-app mapping guide; ? is the web convention for one.",
    },
  }),
  define({
    id: "device.move_earlier",
    label: "Move device earlier",
    description:
      "Moves the device whose header has focus one place earlier in its chain.",
    group: "mixer_devices",
    contexts: ["editor"],
    keys: "Alt+ArrowUp",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live reorders devices by dragging only; this is the keyboard way to do what the drag does.",
    },
  }),
  define({
    id: "device.move_later",
    label: "Move device later",
    description: "Moves the device whose header has focus one place later in its chain.",
    group: "mixer_devices",
    contexts: ["editor"],
    keys: "Alt+ArrowDown",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live reorders devices by dragging only; this is the keyboard way to do what the drag does.",
    },
  }),
  define({
    id: "track.move_left",
    label: "Move track left",
    description:
      "Moves the track whose mixer strip has focus one place left, as dragging the strip does.",
    group: "mixer_devices",
    contexts: ["editor"],
    keys: "ArrowLeft",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live reorders tracks by dragging only; this is the keyboard way to do what the drag does.",
    },
  }),
  define({
    id: "track.move_right",
    label: "Move track right",
    description:
      "Moves the track whose mixer strip has focus one place right, as dragging the strip does.",
    group: "mixer_devices",
    contexts: ["editor"],
    keys: "ArrowRight",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live reorders tracks by dragging only; this is the keyboard way to do what the drag does.",
    },
  }),
  define({
    id: "arrangement.loop_move_earlier",
    label: "Move loop earlier",
    description: "Moves the focused loop brace one bar earlier.",
    group: "arrangement",
    contexts: ["loop_brace"],
    keys: "ArrowLeft",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live sets its loop by dragging or Cmd/Ctrl+L on a selection; this is the keyboard way to do what dragging the brace does.",
    },
  }),
  define({
    id: "arrangement.loop_move_later",
    label: "Move loop later",
    description: "Moves the focused loop brace one bar later.",
    group: "arrangement",
    contexts: ["loop_brace"],
    keys: "ArrowRight",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live sets its loop by dragging or Cmd/Ctrl+L on a selection; this is the keyboard way to do what dragging the brace does.",
    },
  }),
  define({
    id: "arrangement.loop_shorten",
    label: "Shorten loop",
    description: "Ends the focused loop brace one bar sooner, down to one bar.",
    group: "arrangement",
    contexts: ["loop_brace"],
    keys: "Shift+ArrowLeft",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live sets its loop by dragging or Cmd/Ctrl+L on a selection; this is the keyboard way to do what dragging the brace does.",
    },
  }),
  define({
    id: "arrangement.loop_lengthen",
    label: "Lengthen loop",
    description: "Ends the focused loop brace one bar later.",
    group: "arrangement",
    contexts: ["loop_brace"],
    keys: "Shift+ArrowRight",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live sets its loop by dragging or Cmd/Ctrl+L on a selection; this is the keyboard way to do what dragging the brace does.",
    },
  }),
  define({
    id: "track.select_previous",
    label: "Select previous track",
    description:
      "Selects the track above the current one in the arrangement and instrument views; stops at the first track.",
    group: "navigation",
    contexts: ["editor"],
    keys: "ArrowUp",
    ableton: {
      kind: "solid_groove",
      reason: "the arrow keys step the editor's selected track through the track list.",
    },
  }),
  define({
    id: "track.select_next",
    label: "Select next track",
    description:
      "Selects the track below the current one in the arrangement and instrument views; stops at the last track.",
    group: "navigation",
    contexts: ["editor"],
    keys: "ArrowDown",
    ableton: {
      kind: "solid_groove",
      reason: "the arrow keys step the editor's selected track through the track list.",
    },
  }),
  define({
    id: "note.move_up",
    label: "Move notes up",
    description: "Moves the selected notes up one visible row of the piano roll.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "ArrowUp",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Up" },
  }),
  define({
    id: "note.move_down",
    label: "Move notes down",
    description: "Moves the selected notes down one visible row of the piano roll.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "ArrowDown",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Down" },
  }),
  define({
    id: "note.octave_up",
    label: "Move notes up an octave",
    description: "Moves the selected notes up twelve semitones.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "Shift+ArrowUp",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Shift+Up" },
  }),
  define({
    id: "note.octave_down",
    label: "Move notes down an octave",
    description: "Moves the selected notes down twelve semitones.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "Shift+ArrowDown",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Shift+Down" },
  }),
  define({
    id: "note.move_earlier",
    label: "Move notes earlier",
    description: "Moves the selected notes one step earlier.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "ArrowLeft",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Left" },
  }),
  define({
    id: "note.move_later",
    label: "Move notes later",
    description: "Moves the selected notes one step later.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "ArrowRight",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Right" },
  }),
  define({
    id: "note.shorten",
    label: "Shorten notes",
    description: "Makes the selected notes one step shorter.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "Shift+ArrowLeft",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Shift+Left" },
  }),
  define({
    id: "note.lengthen",
    label: "Lengthen notes",
    description: "Makes the selected notes one step longer.",
    group: "clips_notes",
    contexts: ["piano_roll"],
    keys: "Shift+ArrowRight",
    repeatable: true,
    ableton: { kind: "follows", abletonKeys: "Shift+Right" },
  }),
  define({
    id: "value.nudge_up",
    label: "Nudge value up",
    description: "Raises the focused value field by one step.",
    group: "global_editing",
    contexts: ["value_field"],
    keys: "ArrowUp",
    repeatable: true,
    // The field is text entry, and the arrows are what it is for.
    textEntry: "allowed",
    ableton: { kind: "follows", abletonKeys: "Up" },
  }),
  define({
    id: "value.nudge_down",
    label: "Nudge value down",
    description: "Lowers the focused value field by one step.",
    group: "global_editing",
    contexts: ["value_field"],
    keys: "ArrowDown",
    repeatable: true,
    textEntry: "allowed",
    ableton: { kind: "follows", abletonKeys: "Down" },
  }),
  ...LIBRARY_PICKS,
  libraryKey(
    "library.select_previous",
    "Previous sound",
    "Selects the previous sound in the library and auditions it.",
    "ArrowUp",
    { ableton: { kind: "follows", abletonKeys: "Up" } },
  ),
  libraryKey(
    "library.select_next",
    "Next sound",
    "Selects the next sound and auditions it; from the search field it leaves the field.",
    "ArrowDown",
    {
      // Down is how a producer leaves the search field for the list.
      textEntry: "allowed",
      ableton: { kind: "follows", abletonKeys: "Down" },
    },
  ),
  libraryKey(
    "library.audition",
    "Audition again",
    "Plays the selected sound again.",
    "Space",
    // No `preventDefault: false`: the press must not also reach the focused
    // button, which is the Close button when the library opens (#860). A
    // focused control keeps Space through the handler's `isEnabled` instead.
  ),
  libraryKey(
    "library.insert",
    "Insert sound",
    "Puts the selected sound in the slot and closes the library.",
    "Enter",
    {
      // Insert closes the library and focus goes back to the slot that opened
      // it; a default left to run then presses that slot and reopens it (#860).
      ableton: { kind: "follows", abletonKeys: "Enter" },
    },
  ),
  libraryKey(
    "library.like",
    "Like sound",
    "Adds the selected sound to your favourites, or takes it out.",
    "L",
  ),
  libraryKey(
    "library.similar",
    "Similar sounds",
    "Opens the similar-sounds view for the selected sound.",
    "S",
  ),
  libraryKey(
    "library.shuffle",
    "Shuffle",
    "Selects and auditions a random sound from the current list.",
    "R",
  ),
  libraryKey(
    "library.pick_all",
    "All of the family",
    "Shows every sound in the current family.",
    "0",
  ),
  libraryKey(
    "library.category_previous",
    "Previous category",
    "Moves to the previous category in the family.",
    "ArrowLeft",
  ),
  libraryKey(
    "library.category_next",
    "Next category",
    "Moves to the next category in the family.",
    "ArrowRight",
  ),
  libraryKey(
    "library.family_previous",
    "Previous family",
    "Moves to the previous family of sounds.",
    "[",
  ),
  libraryKey(
    "library.family_next",
    "Next family",
    "Moves to the next family of sounds.",
    "]",
  ),
  libraryKey("library.genre_menu", "Genre menu", "Opens the genre filter.", "G"),
  libraryKey(
    "library.loop_tempo",
    "Loop tempo",
    "Under Loops, switches between loops near the song tempo and any tempo.",
    "T",
  ),
  libraryKey(
    "library.all_sounds",
    "All sounds",
    "Shows every sound in the library.",
    "A",
  ),
  libraryKey(
    "library.favourites",
    "Favourites",
    "Shows only the sounds you have liked.",
    "F",
  ),
  libraryKey(
    "library.browse_packs",
    "Browse packs",
    "Swaps the list for the grid of packs.",
    "P",
  ),
  libraryKey(
    "library.back",
    "Back",
    "Goes back out of similar sounds, a pack, or Browse packs.",
    "Backspace",
  ),
  libraryKey(
    "library.search",
    "Search",
    "Moves focus to the library's search field.",
    "/",
  ),
  exportKey(
    "export.focus_previous",
    "Focus previous track",
    "Moves focus to the track above in the Export dialog's track list; stops at the first.",
    "ArrowUp",
  ),
  exportKey(
    "export.focus_next",
    "Focus next track",
    "Moves focus to the track below in the Export dialog's track list; stops at the last.",
    "ArrowDown",
  ),
  exportKey(
    "export.extend_previous",
    "Extend pick upward",
    "Moves focus up and adds the tracks it passes to the pick.",
    "Shift+ArrowUp",
  ),
  exportKey(
    "export.extend_next",
    "Extend pick downward",
    "Moves focus down and adds the tracks it passes to the pick.",
    "Shift+ArrowDown",
  ),
  exportKey(
    "export.toggle_focused",
    "Include or leave out track",
    "Flips the focused track, or every picked track, in or out of the export.",
    ["Space", "Enter"],
  ),
  exportKey(
    "export.pick_all",
    "Pick every track",
    "Picks every track in the Export dialog's list, ready to flip together.",
    "Mod+A",
  ),
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

/**
 * Parsed chords, memoized per *definition object* rather than per action ID.
 *
 * Keying on identity is what keeps the remapping note above honest: an override
 * layer replaces an entry with a new frozen object, which is a cache miss by
 * construction, so a stale parse can never outlive the keys it came from. (An
 * entry's `keys` are readonly, so the only way to change a mapping is to
 * replace the entry.) A `WeakMap` also means a discarded override is collected
 * with its chords rather than pinned by the cache.
 */
const chordCache = new WeakMap<
  ShortcutDefinition,
  Map<ShortcutPlatform, readonly KeyChord[]>
>();

/** The parsed chords for one action on one platform. */
export function chordsFor(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
): readonly KeyChord[] {
  let byPlatform = chordCache.get(shortcut);
  if (!byPlatform) {
    byPlatform = new Map();
    chordCache.set(shortcut, byPlatform);
  }
  const cached = byPlatform.get(platform);
  if (cached) return cached;
  const chords = keySpecsFor(shortcut, platform).map((spec) =>
    parseChord(spec, platform),
  );
  byPlatform.set(platform, chords);
  return chords;
}

/**
 * The label a tooltip or menu item shows, e.g. `Cmd+Shift+Z`. Where an action
 * has more than one combination the first is canonical.
 */
export function shortcutLabel(id: ShortcutActionId, platform: ShortcutPlatform): string {
  const chords = chordsFor(shortcutById(id), platform);
  return chordLabel(chords[0], platform);
}

/** Every label for an action, for the guide's key column. */
export function shortcutLabels(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
): readonly string[] {
  return chordsFor(shortcut, platform).map((chord) => chordLabel(chord, platform));
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
  if (active.includes(MODAL_CONTEXT)) {
    return [MODAL_CONTEXT, ...MODAL_OWNED_CONTEXTS.filter((c) => active.includes(c))];
  }
  return active.includes(AMBIENT_CONTEXT) ? active : [AMBIENT_CONTEXT, ...active];
}

/**
 * Narrows shortcuts that match one event to the most specific surface's own,
 * when it has any: a focus context (`FOCUS_CONTEXTS`) outranks everything else
 * for the keys it claims, so `Left` moves a focused loop brace rather than
 * also meaning `track.move_left`; then an overlay context (`OVERLAY_CONTEXTS`)
 * outranks the editor behind it, so the open piano roll's arrows move notes.
 * With neither among them the list is returned unchanged.
 */
export function preferFocused(
  matches: readonly ShortcutDefinition[],
  resolved: readonly ShortcutContext[],
): readonly ShortcutDefinition[] {
  for (const tier of [FOCUS_CONTEXTS, OVERLAY_CONTEXTS]) {
    const claimed = matches.filter((shortcut) =>
      shortcut.contexts.some(
        (context) => tier.includes(context) && resolved.includes(context),
      ),
    );
    if (claimed.length > 0) return claimed;
  }
  return matches;
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
  const matches = SHORTCUTS.filter(
    (shortcut) =>
      isInContext(shortcut, resolved) &&
      chordsFor(shortcut, platform).some((chord) => matchesChord(chord, event, platform)),
  );
  return preferFocused(matches, resolved)[0];
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
