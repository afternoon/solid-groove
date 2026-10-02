import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDocs,
  onSnapshot,
  type QuerySnapshot,
  setDoc,
} from "firebase/firestore";
import { type Clock, systemClock } from "../shared/clock";
import {
  decodeFavourite,
  encodeFavourite,
  type Favourite,
  favouriteDocumentPath,
  favouritesCollectionPath,
  type SoundReference,
  sortFavourites,
  soundReferenceSchema,
} from "./favouriteDocuments";
import {
  type FavouriteAddResult,
  type FavouriteFailure,
  type FavouriteRemoveResult,
  type FavouritesLoadResult,
  type FavouritesRepository,
  type FavouritesWatchEvent,
  favouriteFailure,
} from "./favouritesRepository";
import type { Unsubscribe } from "./projectRepository";

/**
 * The Firestore favourites store (LIB-011, #691).
 *
 * Each favourite is its own document under `users/{uid}/favourites`, so an add
 * is one `setDoc` and a remove one `deleteDoc` — no transaction and no read
 * first, which also means the write is queued locally and applied when an
 * offline session reconnects. A collection listener delivers every change to
 * every session of the same user.
 *
 * Like `FirestoreProjectRepository`, the `Firestore` instance is injected, so
 * the emulator suite runs the identical code through the real security rules.
 */
export class FirestoreFavouritesRepository implements FavouritesRepository {
  private readonly db: Firestore;
  private readonly clock: Clock;

  constructor(db: Firestore, options: { clock?: Clock } = {}) {
    this.db = db;
    this.clock = options.clock ?? systemClock;
  }

  async listFavourites(uid: string): Promise<FavouritesLoadResult> {
    try {
      const snapshot = await getDocs(collection(this.db, favouritesCollectionPath(uid)));
      return { ok: true, favourites: decodeSnapshot(snapshot) };
    } catch (error) {
      return toFailure(error);
    }
  }

  async addFavourite(
    uid: string,
    reference: SoundReference,
  ): Promise<FavouriteAddResult> {
    const parsed = soundReferenceSchema.safeParse(reference);
    if (!parsed.success) {
      return favouriteFailure("invalid_reference", parsed.error.message);
    }
    const favourite: Favourite = { ...parsed.data, favouritedAt: this.clock.now() };
    try {
      await setDoc(
        doc(this.db, favouriteDocumentPath(uid, favourite)),
        encodeFavourite(favourite),
      );
      return { ok: true, favourite };
    } catch (error) {
      return toFailure(error);
    }
  }

  async removeFavourite(
    uid: string,
    reference: SoundReference,
  ): Promise<FavouriteRemoveResult> {
    const parsed = soundReferenceSchema.safeParse(reference);
    if (!parsed.success) {
      return favouriteFailure("invalid_reference", parsed.error.message);
    }
    try {
      await deleteDoc(doc(this.db, favouriteDocumentPath(uid, parsed.data)));
      return { ok: true };
    } catch (error) {
      return toFailure(error);
    }
  }

  watchFavourites(
    uid: string,
    listener: (event: FavouritesWatchEvent) => void,
  ): Unsubscribe {
    return onSnapshot(
      collection(this.db, favouritesCollectionPath(uid)),
      (snapshot) =>
        listener({ kind: "favourites", favourites: decodeSnapshot(snapshot) }),
      (error) => listener({ kind: "error", message: error.message }),
    );
  }
}

/**
 * Every favourite in a snapshot, newest first. A document this build cannot
 * read is left out of the list rather than failing it, as the dashboard does
 * with a malformed project.
 */
function decodeSnapshot(snapshot: QuerySnapshot): Favourite[] {
  const favourites: Favourite[] = [];
  for (const entry of snapshot.docs) {
    const decoded = decodeFavourite(entry.id, entry.data());
    if (decoded) favourites.push(decoded);
  }
  return sortFavourites(favourites);
}

function toFailure(error: unknown): FavouriteFailure {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (code === "permission-denied") {
    return favouriteFailure(
      "not_allowed",
      "The current user may not access these favourites",
    );
  }
  return favouriteFailure(
    "unavailable",
    error instanceof Error ? error.message : String(error),
  );
}

export function createFirestoreFavouritesRepository(
  db: Firestore,
  options: { clock?: Clock } = {},
): FirestoreFavouritesRepository {
  return new FirestoreFavouritesRepository(db, options);
}
