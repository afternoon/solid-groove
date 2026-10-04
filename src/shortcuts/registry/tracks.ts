// Track and device-chain shortcuts. Part of the one shortcut registry: see
// `../registry.ts`.

import { define, type ShortcutDefinition } from "./define";

/** Reordering devices in a chain and tracks in the song. */
export const TRACK_ORDER_SHORTCUT_IDS = [
  "device.move_earlier",
  "device.move_later",
  "track.move_left",
  "track.move_right",
] as const;

export const TRACK_ORDER_SHORTCUTS: readonly ShortcutDefinition[] = [
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
];
