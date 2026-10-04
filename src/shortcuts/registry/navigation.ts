// Navigation shortcuts: zoom and scroll, views, surfaces and the track
// selection. Part of the one shortcut registry: see `../registry.ts`.

import type { AbletonParity } from "../types";
import { define, type ShortcutDefinition } from "./define";

const VIEW_KEY_PARITY: AbletonParity = {
  kind: "solid_groove",
  reason:
    "Live shows everything at once and has no view to switch to; 1-5 is the hardware idiom UI-001 and UI-002 borrow.",
};

/**
 * The five views on `1`-`5` (`UI-002`), in key order: song, clip, sound, the
 * sounds you could swap in, and the mix. The number row drawn on the dock.
 */
const EDITOR_VIEW_KEYS = [
  ["arrangement", "Show the arrangement", "Switches the editor to the arrangement.", "1"],
  [
    "sequence",
    "Show the sequence",
    "Switches the editor to the selected clip's steps or notes.",
    "2",
  ],
  [
    "instrument",
    "Show the instrument",
    "Switches the editor to the selected track's instrument.",
    "3",
  ],
  [
    "library",
    "Show the library",
    "Switches the editor to the library, aimed at the selected sample slot.",
    "4",
  ],
  ["mixer", "Show the mixer", "Switches the editor to the mixer.", "5"],
] as const;

/** Zoom and scroll, the five views on `1`-`5`, opening a clip, closing a surface, and the guide. */
export const VIEW_SHORTCUT_IDS = [
  "view.zoom_to_selection",
  "view.zoom_back",
  "view.zoom_to_arrangement",
  "view.scroll_to_playhead",
  "view.zoom_in",
  "view.zoom_out",
  "view.show_arrangement",
  "view.show_sequence",
  "view.show_instrument",
  "view.show_library",
  "view.show_mixer",
  "arrangement.open_clip",
  "view.close_surface",
  "help.shortcut_guide",
] as const;

export const VIEW_SHORTCUTS: readonly ShortcutDefinition[] = [
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
  ...EDITOR_VIEW_KEYS.map(([view, label, description, keys]) =>
    define({
      id: `view.show_${view}`,
      label,
      description,
      group: "navigation",
      // The library's own keys share its context, so the views stay one key
      // away from inside it (UI-002).
      contexts: ["editor", "sequence_editor", "library"],
      keys,
      ableton: VIEW_KEY_PARITY,
    }),
  ),
  define({
    id: "arrangement.open_clip",
    label: "Open clip",
    description: "Opens the selected clip in the sequence view.",
    group: "navigation",
    contexts: ["arrangement"],
    keys: "Enter",
    ableton: {
      kind: "solid_groove",
      reason:
        "Live shows a clip's notes under the arrangement; Groove's are a view of their own.",
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
];

/** Stepping the selected track up and down. */
export const TRACK_SELECT_SHORTCUT_IDS = [
  "track.select_previous",
  "track.select_next",
] as const;

export const TRACK_SELECT_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];
