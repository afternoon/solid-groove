import type { Analytics } from "../analytics";
import type { Favourite, SoundReference } from "../persistence/favouriteDocuments";
import type {
  FavouriteAddResult,
  FavouriteRemoveResult,
  FavouritesRepository,
} from "../persistence/favouritesRepository";

/**
 * The library's side of a producer's favourite sounds (LIB-011, #691): turning
 * stored references back into library sounds, and the one place a favourite is
 * added or removed so its analytics fire exactly once per action.
 *
 * The repository stores references, never library facts, so whether a
 * favourite still resolves is decided here, against the packs the library has
 * actually loaded. A favourite that no longer resolves is reported as missing,
 * with the reason, and keeps its place in the list. It is never silently
 * dropped, so the producer can see it went and take it out themselves.
 */

/** Why a favourite no longer resolves to a sound. */
export type MissingFavouriteReason =
  /** The library holds no version of the favourite's pack. */
  | "pack_unavailable"
  /** The pack is there, but the sound is not in it any more. */
  | "asset_unavailable";

/** The fields of a library sound this module needs to match a favourite. */
export interface FavouriteCandidate {
  readonly id: string;
  readonly packId: string;
}

export type ResolvedFavourite<A extends FavouriteCandidate> =
  | { readonly status: "available"; readonly favourite: Favourite; readonly asset: A }
  | {
      readonly status: "missing";
      readonly favourite: Favourite;
      readonly reason: MissingFavouriteReason;
    };

/** What the library currently holds: the packs it has, and their sounds. */
export interface FavouriteLibrary<A extends FavouriteCandidate> {
  readonly packIds: Iterable<string>;
  readonly assets: readonly A[];
}

/**
 * Resolves each favourite against the library, in the favourites' own order.
 * Every favourite yields exactly one entry, available or missing.
 */
export function resolveFavourites<A extends FavouriteCandidate>(
  favourites: readonly Favourite[],
  library: FavouriteLibrary<A>,
): ResolvedFavourite<A>[] {
  const packs = new Set(library.packIds);
  const assets = new Map<string, A>();
  for (const asset of library.assets) {
    packs.add(asset.packId);
    assets.set(soundKey(asset.packId, asset.id), asset);
  }

  return favourites.map((favourite) => {
    const asset = assets.get(soundKey(favourite.packId, favourite.assetId));
    if (asset) return { status: "available", favourite, asset };
    return {
      status: "missing",
      favourite,
      reason: packs.has(favourite.packId) ? "asset_unavailable" : "pack_unavailable",
    };
  });
}

function soundKey(packId: string, assetId: string): string {
  return `${packId}\u0000${assetId}`;
}

export interface FavouriteActionsOptions {
  readonly repository: FavouritesRepository;
  readonly analytics: Pick<Analytics, "log" | "logFeatureFirstUse">;
}

export interface FavouriteActions {
  /** Favourites a sound for `uid`. */
  add(uid: string, reference: SoundReference): Promise<FavouriteAddResult>;
  /** Takes a sound out of `uid`'s favourites. */
  remove(uid: string, reference: SoundReference): Promise<FavouriteRemoveResult>;
  /** Adds or removes, for a heart or `L` that toggles. */
  set(
    uid: string,
    reference: SoundReference,
    favourited: boolean,
  ): Promise<FavouriteAddResult | FavouriteRemoveResult>;
}

/**
 * The user action behind a heart press or `L`. Each successful add or remove
 * logs `library_favourite_changed` once, saying only which way it went: the
 * sound and its pack are deliberately not named. The first favourite a
 * producer ever adds also logs `feature_first_use` for `library_favourites`.
 * A write that fails changed nothing, so it logs nothing.
 */
export function createFavouriteActions(
  options: FavouriteActionsOptions,
): FavouriteActions {
  const { repository, analytics } = options;

  async function add(uid: string, reference: SoundReference) {
    const result = await repository.addFavourite(uid, reference);
    if (result.ok) {
      analytics.log("library_favourite_changed", { favourited: true });
      analytics.logFeatureFirstUse("library_favourites");
    }
    return result;
  }

  async function remove(uid: string, reference: SoundReference) {
    const result = await repository.removeFavourite(uid, reference);
    if (result.ok) {
      analytics.log("library_favourite_changed", { favourited: false });
    }
    return result;
  }

  return {
    add,
    remove,
    set: (uid, reference, favourited) =>
      favourited ? add(uid, reference) : remove(uid, reference),
  };
}
