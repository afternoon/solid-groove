// Arrangement shortcuts. Part of the one shortcut registry: see `../registry.ts`.

import { define, type ShortcutDefinition } from "./define";

/** The arrangement's own edits. */
export const ARRANGEMENT_SHORTCUT_IDS = [
  "arrangement.split_clip",
  "arrangement.toggle_loop",
  "arrangement.toggle_automation_view",
] as const;

export const ARRANGEMENT_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];

/** The focused loop brace's keys (`LOOP-018`), live only in `loop_brace`. */
export const LOOP_BRACE_SHORTCUT_IDS = [
  "arrangement.loop_move_earlier",
  "arrangement.loop_move_later",
  "arrangement.loop_shorten",
  "arrangement.loop_lengthen",
] as const;

export const LOOP_BRACE_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];
