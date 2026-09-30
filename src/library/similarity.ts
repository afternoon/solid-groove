import type { LibraryAsset } from "./manifest";
import { shelfFamilyOf } from "./shelf";

/**
 * Similar sounds (LIB-010): a metadata score on role, genre and length.
 *
 * Deliberately no character tags (the served library carries none) and no audio
 * analysis. Candidates come from every pack, restricted to the reference's shelf
 * family so a loop is only ever compared with loops and a kick with drums.
 */

export interface MatchOn {
  readonly category: boolean;
  readonly genre: boolean;
  readonly length: boolean;
}

export const ALL_MATCH_ON: MatchOn = { category: true, genre: true, length: true };

/** Weights of the enabled criteria; the percentage is over their sum. */
export const MATCH_WEIGHTS = { category: 4, genre: 1, length: 2 } as const;

export interface SimilarSound {
  readonly asset: LibraryAsset;
  /** 0 to 100, a whole number. */
  readonly percent: number;
}

/**
 * Length in the unit the family shares: bars for loops, seconds otherwise.
 * `null` when the manifest states none.
 */
export function lengthOf(asset: LibraryAsset): number | null {
  return asset.type === "loop" ? asset.bars : asset.durationSeconds;
}

/** `1 - |a-b|/max(a,b)`, clamped to 0..1; unknown or non-positive lengths score 0. */
export function lengthCloseness(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0;
  const largest = Math.max(a, b);
  if (largest <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - Math.abs(a - b) / largest));
}

/**
 * The closest sounds to `reference`, best first, ties broken by name.
 *
 * With every criterion switched off there is nothing to score on, so the result
 * is empty rather than a list of arbitrary 0% matches presented as similar.
 */
export function similarSounds(
  reference: LibraryAsset,
  assets: readonly LibraryAsset[],
  matchOn: MatchOn = ALL_MATCH_ON,
  limit = 16,
): SimilarSound[] {
  const max =
    (matchOn.category ? MATCH_WEIGHTS.category : 0) +
    (matchOn.genre ? MATCH_WEIGHTS.genre : 0) +
    (matchOn.length ? MATCH_WEIGHTS.length : 0);
  const family = shelfFamilyOf(reference);
  if (max === 0 || family === null) return [];
  return assets
    .filter((a) => a.id !== reference.id && shelfFamilyOf(a) === family)
    .map((asset) => {
      let score = 0;
      if (matchOn.category && asset.role === reference.role)
        score += MATCH_WEIGHTS.category;
      if (matchOn.genre && asset.genres.some((g) => reference.genres.includes(g)))
        score += MATCH_WEIGHTS.genre;
      if (matchOn.length)
        score +=
          MATCH_WEIGHTS.length * lengthCloseness(lengthOf(reference), lengthOf(asset));
      return { asset, percent: Math.round((score / max) * 100) };
    })
    .sort((a, b) => b.percent - a.percent || a.asset.name.localeCompare(b.asset.name))
    .slice(0, limit);
}
