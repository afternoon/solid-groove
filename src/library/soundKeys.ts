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

/**
 * Controls whose own Enter and Space the library's keys leave alone (#860).
 * A sound row's main button and Insert do what the keys do anyway, and the
 * close button is only where the dialog parks focus when it opens.
 */
const CONTROLS =
  "button, a[href], input, select, textarea, summary, [role='checkbox'], [role='tab']";
const STANDS_IN_FOR_THE_LIST = ".sound-row-main, .library-modal-insert, .dialog-close";

/**
 * Whether the focused element is a control that should take Enter or Space
 * itself — a rail button, a chip, a genre checkbox — rather than the library's
 * insert and audition. Those two keys stop the browser's default when they run,
 * so without this a focused control could never be pressed from the keyboard.
 */
export function focusKeepsKey(active: Element | null = document.activeElement): boolean {
  if (!active?.matches(CONTROLS)) return false;
  return !active.matches(STANDS_IN_FOR_THE_LIST);
}
