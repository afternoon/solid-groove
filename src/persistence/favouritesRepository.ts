import type { Favourite, SoundReference } from "./favouriteDocuments";
import type { Unsubscribe } from "./projectRepository";

/**
 * The favourites boundary (LIB-011, #691): one producer's favourite sounds,
 * kept per user so they follow the person across projects and devices.
 *
 * It mirrors `ProjectRepository`: one interface, an in-memory store for unit,
 * component and browser tests, and a Firestore store for production, both run
 * through one contract suite (`favouritesRepositoryContract.ts`). Only the
 * Firestore implementation imports `firebase/firestore`.
 *
 * Every method takes the signed-in user's uid. An anonymous Firebase identity
 * is a real uid, and upgrading the account keeps it, so a guest's favourites
 * are simply still theirs after they register (as their projects are).
 *
 * Adding and removing are idempotent and touch one document each: favouriting
 * a sound that is already a favourite refreshes when it was favourited, and
 * removing one that is not a favourite succeeds without a change.
 */

export type FavouriteFailureReason =
  /** The reference is not a pack-qualified library sound. */
  | "invalid_reference"
  /** The caller may not read or write this user's favourites. */
  | "not_allowed"
  /** The backend could not be reached or failed transiently. */
  | "unavailable";

export interface FavouriteFailure {
  readonly ok: false;
  readonly reason: FavouriteFailureReason;
  readonly message: string;
  /** Whether retrying the identical call could succeed. */
  readonly retryable: boolean;
}

export type FavouriteAddResult =
  | { readonly ok: true; readonly favourite: Favourite }
  | FavouriteFailure;

export type FavouriteRemoveResult = { readonly ok: true } | FavouriteFailure;

export type FavouritesLoadResult =
  | { readonly ok: true; readonly favourites: readonly Favourite[] }
  | FavouriteFailure;

export type FavouritesWatchEvent =
  /** The user's whole favourites list, newest first, after any change. */
  | { readonly kind: "favourites"; readonly favourites: readonly Favourite[] }
  | { readonly kind: "error"; readonly message: string };

export interface FavouritesRepository {
  /** Every favourite the user holds, most recently favourited first. */
  listFavourites(uid: string): Promise<FavouritesLoadResult>;

  /** Favourites one sound. Writes one document. */
  addFavourite(uid: string, reference: SoundReference): Promise<FavouriteAddResult>;

  /** Un-favourites one sound. Deletes one document. */
  removeFavourite(uid: string, reference: SoundReference): Promise<FavouriteRemoveResult>;

  /**
   * Reports the full list once on subscribe and again after every change,
   * including a change made by another session of the same user.
   */
  watchFavourites(
    uid: string,
    listener: (event: FavouritesWatchEvent) => void,
  ): Unsubscribe;
}

export function favouriteFailure(
  reason: FavouriteFailureReason,
  message: string,
): FavouriteFailure {
  return { ok: false, reason, message, retryable: reason === "unavailable" };
}
