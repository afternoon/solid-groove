// Clip and note shortcuts. Part of the one shortcut registry: see `../registry.ts`.

import { define, type ShortcutDefinition } from "./define";

/** The note editors' clip-wide keys. */
export const CLIP_SHORTCUT_IDS = ["clip.quantize", "clip.toggle_draw_mode"] as const;

export const CLIP_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];

/** The piano roll's note moves (`ARR-010`). */
export const NOTE_MOVE_SHORTCUT_IDS = [
  "note.move_up",
  "note.move_down",
  "note.octave_up",
  "note.octave_down",
  "note.move_earlier",
  "note.move_later",
  "note.shorten",
  "note.lengthen",
] as const;

export const NOTE_MOVE_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];
