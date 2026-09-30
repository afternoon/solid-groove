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
