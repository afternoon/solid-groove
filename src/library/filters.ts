import type { LibraryAsset } from "./manifest";
import { matchesLibraryQuery } from "./search";
import {
  roleLabel,
  rolesOf,
  SHELF_FAMILIES,
  type ShelfFamily,
  shelfFamilyOf,
} from "./shelf";

/**
 * The library's filters (LIB-010): genre multi-select, loop tempo and bars,
 * text search, the genre menu's counts and role-name jumps. Pure over loaded
 * assets, like the shelf they narrow.
 */

/** The loop tempo window: "Near" keeps loops within this many BPM of the song. */
export const NEAR_TEMPO_BPM = 10;

/** The bars choices under Loops; `null` is "Any". */
export const LOOP_BARS_CHOICES = [null, 1, 2, 4, 8] as const;

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export type LibraryScope =
  | { readonly kind: "all" }
  | { readonly kind: "favourites"; readonly assetIds: ReadonlySet<string> }
  | { readonly kind: "pack"; readonly packId: string };

/** The sounds in view for a scope, before filters. */
export function scopeAssets(
  assets: readonly LibraryAsset[],
  scope: LibraryScope,
): LibraryAsset[] {
  switch (scope.kind) {
    case "all":
      return [...assets];
    case "favourites":
      return assets.filter((asset) => scope.assetIds.has(asset.id));
    case "pack":
      return assets.filter((asset) => asset.packId === scope.packId);
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type TempoFilter = "near" | "any";

export interface SoundFilters {
  readonly query: string;
  /** Any selected genre matches; empty admits everything. */
  readonly genres: readonly string[];
  /** Loops only. `near` needs the song tempo. */
  readonly tempo: TempoFilter;
  readonly songBpm: number;
  /** Loops only: an exact bar count, or `null` for any. */
  readonly bars: number | null;
}

export function defaultFilters(songBpm: number): SoundFilters {
  return { query: "", genres: [], tempo: "any", songBpm, bars: null };
}

/**
 * The sounds that pass every filter. Tempo and bars describe loops, so they
 * never remove a one-shot; a loop with no declared tempo does not pass `near`.
 */
export function filterSounds(
  assets: readonly LibraryAsset[],
  filters: SoundFilters,
): LibraryAsset[] {
  const needle = filters.query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (!matchesLibraryQuery(asset, needle)) return false;
    if (
      filters.genres.length > 0 &&
      !filters.genres.some((g) => asset.genres.includes(g))
    )
      return false;
    if (asset.type !== "loop") return true;
    if (filters.bars !== null && asset.bars !== filters.bars) return false;
    if (filters.tempo === "near") {
      return (
        asset.bpm !== null && Math.abs(asset.bpm - filters.songBpm) <= NEAR_TEMPO_BPM
      );
    }
    return true;
  });
}

export interface GenreCount {
  readonly genre: string;
  readonly count: number;
}

/** Genres with counts for the menu: most sounds first, ties by name. */
export function genreCounts(assets: readonly LibraryAsset[]): GenreCount[] {
  const counts = new Map<string, number>();
  for (const asset of assets)
    for (const genre of new Set(asset.genres))
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

export interface RoleJump {
  readonly family: ShelfFamily;
  readonly role: string;
  readonly label: string;
}

/**
 * Roles a query names ("hat" -> Closed hat, Open hat) that have sounds in
 * scope, in shelf order. Pass the sounds *before* the text filter: a query that
 * hides every sound must still offer the role it names.
 */
export function roleJumps(sounds: readonly LibraryAsset[], query: string): RoleJump[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const jumps: RoleJump[] = [];
  for (const family of SHELF_FAMILIES) {
    const present = new Set(
      sounds.filter((s) => shelfFamilyOf(s) === family).map((s) => s.role),
    );
    for (const role of rolesOf(family, [...present])) {
      const label = roleLabel(role);
      if (present.has(role) && label.toLowerCase().includes(needle))
        jumps.push({ family, role, label });
    }
  }
  return jumps;
}
