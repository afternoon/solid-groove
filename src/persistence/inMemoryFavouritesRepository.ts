import type { JsonObject } from "../domain/serialize";
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
  type FavouriteRemoveResult,
  type FavouritesLoadResult,
  type FavouritesRepository,
  type FavouritesWatchEvent,
  favouriteFailure,
} from "./favouritesRepository";
import type { WriteRecord } from "./inMemoryProjectRepository";
import type { Unsubscribe } from "./projectRepository";

/**
 * The in-memory favourites store: the encoded documents at their real paths,
 * run through the same encode/decode as the Firestore store, so the shared
 * contract suite exercises the actual mapping. It has no notion of identity
 * (any caller may name any uid), like `InMemoryProjectRepository`; the rules
 * that keep one user out of another's favourites are proved in the emulator
 * suite.
 *
 * Every write is recorded, which is how a test asserts that a favourite change
 * is one document write. Notifications are delivered asynchronously, as
 * Firestore's are, so a caller cannot come to depend on a synchronous echo.
 */
export class InMemoryFavouritesRepository implements FavouritesRepository {
  private readonly documents = new Map<string, JsonObject>();
  private readonly listeners = new Map<
    string,
    Set<(event: FavouritesWatchEvent) => void>
  >();
  private readonly writeLog: WriteRecord[] = [];
  private readonly clock: Clock;

  constructor(options: { clock?: Clock } = {}) {
    this.clock = options.clock ?? systemClock;
  }

  get writes(): readonly WriteRecord[] {
    return this.writeLog;
  }

  clearWrites(): void {
    this.writeLog.length = 0;
  }

  /** Writes a stored document verbatim, bypassing validation (test seeding). */
  writeDocument(path: string, data: JsonObject): void {
    this.documents.set(path, structuredClone(data));
    this.emit(uidOf(path));
  }

  async listFavourites(uid: string): Promise<FavouritesLoadResult> {
    return { ok: true, favourites: this.read(uid) };
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
    const path = favouriteDocumentPath(uid, favourite);
    this.documents.set(path, encodeFavourite(favourite));
    this.writeLog.push({ kind: "set", path });
    this.emit(uid);
    return { ok: true, favourite };
  }

  async removeFavourite(
    uid: string,
    reference: SoundReference,
  ): Promise<FavouriteRemoveResult> {
    const parsed = soundReferenceSchema.safeParse(reference);
    if (!parsed.success) {
      return favouriteFailure("invalid_reference", parsed.error.message);
    }
    const path = favouriteDocumentPath(uid, parsed.data);
    this.documents.delete(path);
    this.writeLog.push({ kind: "delete", path });
    this.emit(uid);
    return { ok: true };
  }

  watchFavourites(
    uid: string,
    listener: (event: FavouritesWatchEvent) => void,
  ): Unsubscribe {
    const listeners = this.listeners.get(uid) ?? new Set();
    listeners.add(listener);
    this.listeners.set(uid, listeners);
    let active = true;
    queueMicrotask(() => {
      if (active) listener({ kind: "favourites", favourites: this.read(uid) });
    });
    return () => {
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(uid);
    };
  }

  private read(uid: string): Favourite[] {
    const prefix = `${favouritesCollectionPath(uid)}/`;
    const favourites: Favourite[] = [];
    for (const [path, data] of this.documents) {
      if (!path.startsWith(prefix)) continue;
      const decoded = decodeFavourite(path.slice(prefix.length), data);
      if (decoded) favourites.push(decoded);
    }
    return sortFavourites(favourites);
  }

  private emit(uid: string): void {
    const listeners = this.listeners.get(uid);
    if (!listeners || listeners.size === 0) return;
    const favourites = this.read(uid);
    queueMicrotask(() => {
      for (const listener of listeners) listener({ kind: "favourites", favourites });
    });
  }
}

/** The uid segment of a `users/{uid}/...` path. */
function uidOf(path: string): string {
  return path.split("/")[1] ?? "";
}

export function createInMemoryFavouritesRepository(
  options: { clock?: Clock } = {},
): InMemoryFavouritesRepository {
  return new InMemoryFavouritesRepository(options);
}
