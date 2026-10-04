import type { ShelfEntry } from "./shelf";

/** Keyboard stepping over an ordered list, and the digit keys' role pick (LIB-010). */

/** The next item, clamped at the end. From nothing it is the first. */
export function nextIn<T>(items: readonly T[], current: T | null): T | null {
  if (items.length === 0) return null;
  const index = current === null ? -1 : items.indexOf(current);
  return items[Math.min(index + 1, items.length - 1)];
}

/** The previous item, clamped at the start. From nothing it is the first. */
export function previousIn<T>(items: readonly T[], current: T | null): T | null {
  if (items.length === 0) return null;
  const index = current === null ? 0 : items.indexOf(current);
  return items[Math.max(index - 1, 0)];
}

/**
 * The id of a list's one Tab stop (#880, roving `tabindex`): the selected item
 * while it is in the list, else the first. `null` for an empty list.
 */
export function tabStopId(
  ids: readonly string[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null && ids.includes(selectedId)) return selectedId;
  return ids[0] ?? null;
}

/**
 * Bring a list's selected row into view, and focus its main button when
 * `focus` is set: the arrow keys move focus with the selection (#880), so a
 * screen reader names the sound and the focus ring marks it.
 */
export function revealSelectedRow(list: HTMLElement | undefined, focus: boolean): void {
  const row = list?.querySelector(".sound-row-selected");
  row?.scrollIntoView?.({ block: "nearest" });
  if (focus)
    row?.querySelector<HTMLElement>(".sound-row-main")?.focus({ preventScroll: true });
}

/**
 * The role a digit key picks: `0` is all roles (`null`), `1`-`9` the nth role.
 * Returns `undefined` when there is no such role, so the key does nothing.
 */
export function roleForDigit(
  roles: readonly ShelfEntry<string>[],
  digit: number,
): string | null | undefined {
  if (digit === 0) return null;
  return roles[digit - 1]?.key;
}
