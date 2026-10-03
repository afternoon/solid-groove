import type { LibraryClient } from "./libraryClient";
import { hasAudio, type LibraryAsset, type LibraryPackSummary } from "./manifest";
import {
  familyLabel,
  roleLabel,
  SHELF_FAMILIES,
  type ShelfFamily,
  shelfFamilyOf,
} from "./shelf";

/**
 * What the Packs view knows about each pack (LIB-010): the index row, and the
 * pack's assets once its manifest has loaded. Pure helpers over that, so the
 * cover copy and the "Packs with" filter are testable without a DOM.
 */
export interface PackCatalogEntry {
  readonly pack: LibraryPackSummary;
  /** `null` until the manifest loads, and if it failed to. */
  readonly assets: readonly LibraryAsset[] | null;
}

/** How many category names a cover spells out before "+N more". */
export const COVER_CATEGORY_LIMIT = 3;

/** The pack's initials: the typographic stand-in for cover art. */
export function packInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** A pack's categories (roles) by size, biggest first, ties by name. */
export function packCategories(assets: readonly LibraryAsset[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(asset.role, (counts.get(asset.role) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "Kick · Snare · Clap · +4 more" for a cover, or "" before the pack loads. */
export function coverCategoryLine(assets: readonly LibraryAsset[]): string {
  const categories = packCategories(assets);
  const named = categories
    .slice(0, COVER_CATEGORY_LIMIT)
    .map(([role]) => roleLabel(role));
  const more = categories.length - named.length;
  return more > 0 ? [...named, `+${more} more`].join(" · ") : named.join(" · ");
}

/** The families a pack holds sounds in, in shelf order. */
export function packFamilies(assets: readonly LibraryAsset[]): ShelfFamily[] {
  const have = new Set(assets.map(shelfFamilyOf));
  return SHELF_FAMILIES.filter((family) => have.has(family));
}

/** The "Packs with" chips: only families some loaded pack holds. */
export function familyChoices(
  entries: readonly PackCatalogEntry[],
): { key: ShelfFamily; label: string }[] {
  const have = new Set(entries.flatMap((entry) => packFamilies(entry.assets ?? [])));
  return SHELF_FAMILIES.filter((key) => have.has(key)).map((key) => ({
    key,
    label: familyLabel(key),
  }));
}

/** Whether a pack passes the "Packs with" filter; `null` is "Anything". */
export function packHasFamily(
  entry: PackCatalogEntry,
  family: ShelfFamily | null,
): boolean {
  if (family === null) return true;
  return packFamilies(entry.assets ?? []).includes(family);
}

/**
 * The sounds "Hear it" runs through: one per category, biggest categories
 * first, one-shots before loops, at most `limit`.
 */
export function heardSounds(assets: readonly LibraryAsset[], limit = 6): LibraryAsset[] {
  const playable = assets.filter(hasAudio);
  const pool = playable.some((asset) => asset.type === "one-shot")
    ? playable.filter((asset) => asset.type === "one-shot")
    : playable;
  return packCategories(pool)
    .slice(0, limit)
    .flatMap(([role]) => pool.find((asset) => asset.role === role) ?? []);
}

/**
 * Loads the pack index, then each pack's manifest, telling `onChange` after
 * each step. Returns a cancel function. A pack that fails to load stays listed
 * with no assets, so one bad manifest never hides the others (LIB-05).
 */
export function watchPackCatalog(
  client: LibraryClient,
  onChange: (entries: readonly PackCatalogEntry[]) => void,
): () => void {
  let cancelled = false;
  const assets = new Map<string, readonly LibraryAsset[]>();
  void client
    .loadIndex()
    .then((packs) => {
      const emit = () => {
        if (cancelled) return;
        onChange(packs.map((pack) => ({ pack, assets: assets.get(pack.slug) ?? null })));
      };
      emit();
      return Promise.all(
        packs.map(async (pack) => {
          const result = await client.loadPack(pack);
          if (result.ok) assets.set(pack.slug, result.assets);
          emit();
        }),
      );
    })
    .catch(() => {
      // An unreachable index leaves the grid empty; the sounds view reports it.
    });
  return () => {
    cancelled = true;
  };
}
