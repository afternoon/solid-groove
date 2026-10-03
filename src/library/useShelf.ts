import { type Accessor, createMemo, createSignal } from "solid-js";
import { assetStorageRef, type LibraryAsset } from "./manifest";
import {
  type LibrarySlot,
  type ShelfSelection,
  settle,
  shelfFamilies,
  shelfRoles,
  slotSelection,
  soundsInView,
} from "./shelf";
import { nextIn, previousIn, roleForDigit } from "./stepping";

/** What the library was opened for: the slot's kind, and the sound it holds now. */
export interface ShelfSlot {
  readonly kind: LibrarySlot["kind"];
  /** The storage ref of the sound in the slot, to find its manifest entry. */
  readonly ref?: string | null;
}

/**
 * The two-level shelf as reactive state (LIB-010): which family and role are
 * chosen, what each row of the shelf offers, and the sounds in view. The rules
 * are `shelf.ts`'s and `stepping.ts`'s; this only holds the choice. Until the
 * producer picks, the shelf sits where the slot says it should open.
 *
 * `sounds` is what the shelf counts (scope and filters already applied); `all`
 * is the whole library, where the slot's own sound is looked up so that typing
 * in search never moves the opening position; `scope` is what is browsable
 * before the search and filters, and decides which family tabs show (#878).
 */
export function useShelf(
  sounds: Accessor<readonly LibraryAsset[]>,
  all: Accessor<readonly LibraryAsset[]>,
  slot: Accessor<ShelfSlot | undefined>,
  scope: Accessor<readonly LibraryAsset[]> = sounds,
) {
  // A choice remembers the sounds it was made against: until the search or a
  // filter changes them, a chosen family stays even with nothing in it.
  const [picked, setPicked] = createSignal<{
    readonly selection: ShelfSelection;
    readonly against: readonly LibraryAsset[];
  } | null>(null);
  const choose = (selection: ShelfSelection) =>
    setPicked({ selection, against: sounds() });

  const opening = createMemo<ShelfSelection>(() => {
    const at = slot();
    if (!at) return { family: "drums", role: null };
    const held = at.ref
      ? (all().find((a) => a.storageKey && assetStorageRef(a.storageKey) === at.ref) ??
        null)
      : null;
    return slotSelection(
      at.kind === "drum-pad" ? { kind: at.kind, sound: held } : { kind: at.kind },
    );
  });

  const selection = createMemo(() => {
    const choice = picked();
    const current = sounds();
    return settle(
      current,
      choice?.selection ?? opening(),
      choice !== null && choice.against === current,
    );
  });
  const families = createMemo(() => shelfFamilies(sounds(), scope()));
  // Keyed on the family alone, so choosing a category keeps the chips (and the
  // focus on the one just pressed) rather than rebuilding them.
  const family = createMemo(() => selection().family);
  const roles = createMemo(() => shelfRoles(sounds(), family()));
  const inView = createMemo(() => soundsInView(sounds(), selection()));

  const setFamily = (family: ShelfSelection["family"]) => choose({ family, role: null });
  const setRole = (role: string | null) => choose({ family: selection().family, role });

  /** Jump straight to a family and category, as a search's role jump does. */
  const select = (family: ShelfSelection["family"], role: string | null) =>
    choose({ family, role });

  /** `0` is all of the family, `1`-`9` the nth category; a missing one does nothing. */
  function pick(digit: number): void {
    const role = roleForDigit(roles(), digit);
    if (role !== undefined) setRole(role);
  }

  function stepRole(direction: 1 | -1): void {
    const keys = ["", ...roles().map((role) => role.key)];
    const next = (direction === 1 ? nextIn : previousIn)(keys, selection().role ?? "");
    setRole(next ? next : null);
  }

  function stepFamily(direction: 1 | -1): void {
    const keys = families().map((family) => family.key);
    const next = (direction === 1 ? nextIn : previousIn)(keys, selection().family);
    if (next) setFamily(next);
  }

  return {
    selection,
    families,
    roles,
    inView,
    setFamily,
    setRole,
    select,
    pick,
    stepRole,
    stepFamily,
  };
}
