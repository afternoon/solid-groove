// The Export dialog's shortcuts. Part of the one shortcut registry: see
// `../registry.ts`.

import type { ShortcutActionId } from "../registry";
import type { AbletonParity } from "../types";
import { define, type ShortcutDefinition } from "./define";

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

/** The Export dialog's track-list keys (`EXP-004`), live only in `export_tracks`. */
export const EXPORT_SHORTCUT_IDS = [
  "export.focus_previous",
  "export.focus_next",
  "export.extend_previous",
  "export.extend_next",
  "export.toggle_focused",
  "export.pick_all",
] as const;

export const EXPORT_SHORTCUTS: readonly ShortcutDefinition[] = [
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
