// The library modal's shortcuts. Part of the one shortcut registry: see
// `../registry.ts`.

import type { ShortcutActionId } from "../registry";
import type { AbletonParity } from "../types";
import { define, type ShortcutDefinition } from "./define";

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

/** The library modal's keys (`LIB-010`), live only in the `library` context. */
export const LIBRARY_SHORTCUT_IDS = [
  "library.select_previous",
  "library.select_next",
  "library.audition",
  "library.insert",
  "library.insert_and_return",
  "library.like",
  "library.similar",
  "library.shuffle",
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
] as const;

export const LIBRARY_SHORTCUTS: readonly ShortcutDefinition[] = [
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
    "Insert and stay",
    "Puts the selected sound in the slot; the library stays, to try another.",
    "Shift+Enter",
  ),
  libraryKey(
    "library.insert_and_return",
    "Insert sound",
    "Puts the selected sound in the slot and goes back to the instrument, as the Insert button does.",
    "Enter",
    {
      // The library owns Enter (UI-002, #860): the browser's default would
      // also press the focused sound row, re-auditioning instead of
      // inserting. Any other focused control keeps its own Enter.
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
];
