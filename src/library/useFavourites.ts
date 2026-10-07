import { type Accessor, createEffect, createMemo, createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { getFavouritesRepository } from "../favouritesRepositoryClient";
import type { Favourite, SoundReference } from "../persistence/favouriteDocuments";
import type { FavouritesRepository } from "../persistence/favouritesRepository";
import { type Clock, systemClock } from "../shared/clock";
import {
  createFavouriteActions,
  type FavouriteActions,
  type SoundKey,
  soundKey,
} from "./favourites";

/**
 * A producer's favourite sounds as reactive state (#815), over #691's
 * repository: the list the library's Favourites place shows, whether a sound's
 * heart is pressed, and the toggle a heart press or `L` runs.
 *
 * Held by the editor rather than the library view, so the list is already
 * there when the producer comes back to the library. It follows the signed-in
 * user: no uid, no favourites and nothing to toggle.
 *
 * A toggle shows at once: the heart and the list take the new state while the
 * write is on its way, and fall back if it fails, which `failed` then says.
 */
export interface Favourites {
  /** Every favourite, newest first, with any change still being written. */
  readonly list: Accessor<readonly Favourite[]>;
  /** Whether the list has loaded once; until then nothing reads as missing. */
  readonly loaded: Accessor<boolean>;
  /** Whether the last load or write failed. */
  readonly failed: Accessor<boolean>;
  /** Whether a sound is a favourite. */
  isFavourite(sound: SoundKey): boolean;
  /** Favourite a sound, or take it out. Resolves once the write has settled. */
  toggle(sound: SoundKey): Promise<void>;
}

export interface UseFavouritesOptions {
  /** The signed-in user's uid, or `null` when nobody is. */
  readonly uid: Accessor<string | null>;
  readonly repository?: () => Promise<FavouritesRepository>;
  readonly analytics?: Pick<Analytics, "log" | "logFeatureFirstUse">;
  readonly clock?: Clock;
}

export function useFavourites(options: UseFavouritesOptions): Favourites {
  const load = options.repository ?? getFavouritesRepository;
  const clock = options.clock ?? systemClock;
  const [stored, setStored] = createSignal<readonly Favourite[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  // Writes on their way: the state each sound is going to, by `soundKey`.
  const [pending, setPending] = createSignal<ReadonlyMap<string, Favourite | null>>(
    new Map(),
  );
  // Writes that are in but that the watch has not reported yet.
  const [written, setWritten] = createSignal<ReadonlySet<string>>(new Set<string>());
  let active: { uid: string; actions: FavouriteActions } | null = null;

  createEffect(options.uid, (uid) => {
    active = null;
    setStored([]);
    setLoaded(false);
    setFailed(false);
    setPending(new Map());
    setWritten(new Set<string>());
    if (uid === null) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void load().then(
      (repository) => {
        if (stopped) return;
        active = {
          uid,
          actions: createFavouriteActions({
            repository,
            analytics: options.analytics ?? defaultAnalytics,
          }),
        };
        unsubscribe = repository.watchFavourites(uid, (event) => {
          if (event.kind === "error") {
            setFailed(true);
            return;
          }
          setStored(event.favourites);
          setLoaded(true);
        });
      },
      () => {
        if (!stopped) setFailed(true);
      },
    );
    return () => {
      stopped = true;
      active = null;
      unsubscribe?.();
    };
  });

  const list = createMemo(() => {
    const changes = pending();
    if (changes.size === 0) return stored();
    const kept = stored().filter(
      (favourite) => !changes.has(soundKey(favourite.packId, favourite.assetId)),
    );
    const added = [...changes.values()].filter(
      (favourite): favourite is Favourite => favourite !== null,
    );
    return [...added, ...kept];
  });
  const keys = createMemo(
    () =>
      new Set(list().map((favourite) => soundKey(favourite.packId, favourite.assetId))),
  );

  // Sounds with a write on its way, so a second press waits for the first.
  const inFlight = new Set<string>();

  function forget(key: string): void {
    setPending((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  async function toggle(sound: SoundKey): Promise<void> {
    const target = active;
    const key = soundKey(sound.packId, sound.assetId);
    if (!target || inFlight.has(key)) return;
    inFlight.add(key);
    const favourited = !keys().has(key);
    // Library pack IDs are `pak_` IDs; the repository validates the reference.
    const reference = {
      packId: sound.packId,
      assetId: sound.assetId,
    } as SoundReference;
    setPending((current) =>
      new Map(current).set(
        key,
        favourited ? { ...reference, favouritedAt: clock.now() } : null,
      ),
    );
    const result = await target.actions
      .set(target.uid, reference, favourited)
      .catch(() => ({ ok: false as const }));
    inFlight.delete(key);
    if (active !== target) return;
    setFailed(!result.ok);
    if (result.ok) setWritten((current) => new Set(current).add(key));
    else forget(key);
  }

  // A write that is in stops overriding the stored list once the watch agrees
  // with it, so the heart never flickers back in between.
  createEffect(
    () => ({ current: stored(), changes: pending(), done: written() }),
    ({ current, changes, done }) => {
      if (done.size === 0) return;
      const storedKeys = new Set(current.map((f) => soundKey(f.packId, f.assetId)));
      const agreed = [...done].filter(
        (key) => !changes.has(key) || storedKeys.has(key) === (changes.get(key) !== null),
      );
      if (agreed.length === 0) return;
      setWritten((now) => new Set([...now].filter((key) => !agreed.includes(key))));
      setPending((now) => {
        const next = new Map(now);
        for (const key of agreed) next.delete(key);
        return next;
      });
    },
  );

  return {
    list,
    loaded,
    failed,
    isFavourite: (sound) => keys().has(soundKey(sound.packId, sound.assetId)),
    toggle,
  };
}
