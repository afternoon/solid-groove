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

/**
 * The focused clip list's keys (#76), live only in `clip_list`: the keyboard's
 * way to pick a clip, which a pointer does by clicking where it is drawn.
 */
export const CLIP_LIST_SHORTCUT_IDS = [
  "arrangement.clip_previous",
  "arrangement.clip_next",
  "arrangement.clip_extend_previous",
  "arrangement.clip_extend_next",
  "arrangement.clip_shorten",
  "arrangement.clip_lengthen",
  "arrangement.clip_start_earlier",
  "arrangement.clip_start_later",
] as const;

const CLIP_LIST_PARITY = {
  kind: "solid_groove",
  reason:
    "Live picks a clip by clicking it; this is the keyboard way to do what the click does on the canvas.",
} as const;

const CLIP_LIST_EXTEND_PARITY = {
  kind: "solid_groove",
  reason:
    "Live adds a clip to the selection with a modified click; this is the keyboard way to do it from the clip list.",
} as const;

const CLIP_LIST_RESIZE_PARITY = {
  kind: "solid_groove",
  reason:
    "Live resizes a clip by dragging its edge; this is the keyboard way to do what that drag does on the canvas, a bar at a time.",
} as const;

export const CLIP_LIST_SHORTCUTS: readonly ShortcutDefinition[] = [
  define({
    id: "arrangement.clip_previous",
    label: "Select previous clip",
    description:
      "Selects the clip before the selected one, reading the arrangement track by track.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "ArrowUp",
    ableton: CLIP_LIST_PARITY,
  }),
  define({
    id: "arrangement.clip_next",
    label: "Select next clip",
    description:
      "Selects the clip after the selected one, reading the arrangement track by track.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "ArrowDown",
    ableton: CLIP_LIST_PARITY,
  }),
  define({
    id: "arrangement.clip_extend_previous",
    label: "Add previous clip to selection",
    description:
      "Adds the clip before the last one picked to the selection, reading the arrangement track by track.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "Shift+ArrowUp",
    ableton: CLIP_LIST_EXTEND_PARITY,
  }),
  define({
    id: "arrangement.clip_extend_next",
    label: "Add next clip to selection",
    description:
      "Adds the clip after the last one picked to the selection, reading the arrangement track by track.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "Shift+ArrowDown",
    ableton: CLIP_LIST_EXTEND_PARITY,
  }),
  define({
    id: "arrangement.clip_shorten",
    label: "Shorten clip",
    description: "Moves the end of each selected clip a bar earlier, down to one bar.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "Shift+ArrowLeft",
    ableton: CLIP_LIST_RESIZE_PARITY,
  }),
  define({
    id: "arrangement.clip_lengthen",
    label: "Lengthen clip",
    description:
      "Moves the end of each selected clip a bar later, over whatever follows it.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "Shift+ArrowRight",
    ableton: CLIP_LIST_RESIZE_PARITY,
  }),
  define({
    id: "arrangement.clip_start_earlier",
    label: "Move clip start earlier",
    description:
      "Moves the start of each selected clip a bar earlier, revealing more of its content.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "Alt+Shift+ArrowLeft",
    ableton: CLIP_LIST_RESIZE_PARITY,
  }),
  define({
    id: "arrangement.clip_start_later",
    label: "Move clip start later",
    description:
      "Moves the start of each selected clip a bar later, trimming its head, down to one bar.",
    group: "arrangement",
    contexts: ["clip_list"],
    keys: "Alt+Shift+ArrowRight",
    ableton: CLIP_LIST_RESIZE_PARITY,
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
