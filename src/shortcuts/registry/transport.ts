// Transport shortcuts. Part of the one shortcut registry: see `../registry.ts`.

import { define, type ShortcutDefinition } from "./define";

/** The transport's keys: play, stop, continue, the metronome and the loop switch. */
export const TRANSPORT_SHORTCUT_IDS = [
  "transport.play_stop",
  "transport.continue",
  "transport.metronome",
  "transport.toggle_loop",
] as const;

export const TRANSPORT_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];
