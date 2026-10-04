import { z } from "zod";
import { type PackId, packIdSchema } from "../domain/ids";
import type { JsonObject } from "../domain/serialize";

/**
 * The Firestore layout of a user's favourite sounds (LIB-011, #691).
 *
 * Favourites belong to the person, not to a project, so they live under the
 * user rather than under `projects/`:
 *
 * | Path                                   | Contents                         |
 * | -------------------------------------- | -------------------------------- |
 * | `users/{uid}/favourites/{favouriteId}` | One favourited sound             |
 *
 * One document per favourite is what makes adding or removing one a single
 * small document change, and what lets another signed-in session see it live
 * through one collection listener. The document ID is derived from the sound
 * reference, so favouriting the same sound twice lands on the same document
 * instead of creating a duplicate, and removing one needs no lookup.
 *
 * A document holds a pack-qualified sound reference and the time it was
 * favourited, nothing else: no sound or pack name, no URL, no user-entered
 * text. Names are the library's facts, read from the pack manifest when the
 * favourite is shown.
 *
 * Like the project tiers, it carries its own schema version, and its timestamp
 * is integer epoch milliseconds rather than a Firestore `Timestamp`.
 * `firestore.rules` restricts the whole `users/{uid}` subtree to its owner and
 * checks every field written here.
 */

/** The schema version every favourite document is written at. */
export const FAVOURITE_SCHEMA_VERSION = 1;

export const USERS_COLLECTION = "users";
export const FAVOURITES_COLLECTION = "favourites";

/**
 * Longest library asset ID a favourite stores. Library asset IDs are short
 * slugs (`sg-one-shot-drums-kick-0001`); the bound keeps a document small and
 * its ID well inside Firestore's limit, and `firestore.rules` enforces it too.
 */
export const MAX_FAVOURITE_ASSET_ID_LENGTH = 200;

/**
 * A pack-qualified reference to one library sound: the pack it belongs to and
 * its asset ID *in the library* (the manifest's ID, not a project's `ast_` ID,
 * which is minted per project when a sound is inserted).
 */
export interface SoundReference {
  readonly packId: PackId;
  readonly assetId: string;
}

/** One favourite as it is stored and read back. */
export interface Favourite extends SoundReference {
  /** When the sound was (last) favourited, epoch milliseconds. */
  readonly favouritedAt: number;
}

export const soundReferenceSchema = z.object({
  packId: packIdSchema,
  assetId: z.string().min(1).max(MAX_FAVOURITE_ASSET_ID_LENGTH),
});

const favouriteDocumentSchema = z
  .object({
    schemaVersion: z.literal(FAVOURITE_SCHEMA_VERSION),
    packId: packIdSchema,
    assetId: z.string().min(1).max(MAX_FAVOURITE_ASSET_ID_LENGTH),
    favouritedAt: z.number().int().nonnegative(),
  })
  .strict();

/** Separates the pack ID from the encoded asset ID in a document ID. */
const ID_SEPARATOR = "~";

/** `users/{uid}/favourites`. */
export function favouritesCollectionPath(uid: string): string {
  return `${USERS_COLLECTION}/${uid}/${FAVOURITES_COLLECTION}`;
}

/**
 * The document ID for one sound: `{packId}~{encoded assetId}`. The asset ID is
 * URI-encoded so a `/` in a third-party ID can never split the path; a pack ID
 * is a `pak_` ID and needs no encoding.
 */
export function favouriteDocumentId(reference: SoundReference): string {
  return `${reference.packId}${ID_SEPARATOR}${encodeURIComponent(reference.assetId)}`;
}

/** `users/{uid}/favourites/{favouriteId}`. */
export function favouriteDocumentPath(uid: string, reference: SoundReference): string {
  return `${favouritesCollectionPath(uid)}/${favouriteDocumentId(reference)}`;
}

/** Whether two references name the same sound. */
export function sameSound(a: SoundReference, b: SoundReference): boolean {
  return a.packId === b.packId && a.assetId === b.assetId;
}

/** The stored body of one favourite. */
export function encodeFavourite(favourite: Favourite): JsonObject {
  return {
    schemaVersion: FAVOURITE_SCHEMA_VERSION,
    packId: favourite.packId,
    assetId: favourite.assetId,
    favouritedAt: favourite.favouritedAt,
  };
}

/**
 * Reads one stored favourite, or `null` when the document is not one this
 * build understands. The document ID must agree with the reference it holds,
 * so a document copied to another sound's ID is refused rather than adopted.
 */
export function decodeFavourite(documentId: string, data: unknown): Favourite | null {
  const parsed = favouriteDocumentSchema.safeParse(data);
  if (!parsed.success) return null;
  const { packId, assetId, favouritedAt } = parsed.data;
  const favourite: Favourite = { packId, assetId, favouritedAt };
  return favouriteDocumentId(favourite) === documentId ? favourite : null;
}

/**
 * Favourites in the order the library lists them: most recently favourited
 * first, ties broken by document ID so the order is total and stable.
 */
export function sortFavourites(favourites: readonly Favourite[]): Favourite[] {
  return [...favourites].sort((a, b) => {
    if (a.favouritedAt !== b.favouritedAt) return b.favouritedAt - a.favouritedAt;
    const idA = favouriteDocumentId(a);
    const idB = favouriteDocumentId(b);
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}
