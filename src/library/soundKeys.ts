import type { ShortcutActionId } from "../shortcuts";

/**
 * The `library.*` actions the Sounds view answers (LIB-010). `EditorView`
 * registers each of them against the open modal, which forwards them to
 * whichever view is showing; the view, not the host, knows what they mean.
 * Actions the host or another view owns (insert, the rail's places) are not here.
 */
export const SOUNDS_KEY_ACTIONS = [
  "library.select_previous",
  "library.select_next",
  "library.audition",
  "library.similar",
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
  "library.shuffle",
  // The modal answers this one itself (it owns the search field).
  "library.search",
] as const satisfies readonly ShortcutActionId[];

export type SoundsKeyAction = (typeof SOUNDS_KEY_ACTIONS)[number];
