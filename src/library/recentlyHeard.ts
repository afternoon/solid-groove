import { z } from "zod";
import type { SoundKey } from "./favourites";

/**
 * The library's recently heard sounds (#815): the sounds auditioned on this
 * device, most recent first, kept in this browser's storage so the list
 * survives a reload. Per device by product decision, so it never syncs.
 *
 * Hearing a sound puts it at the top; hearing one already listed moves it
 * there rather than listing it twice; the list keeps at most
 * {@link RECENTLY_HEARD_LIMIT} sounds and drops the oldest. It stores
 * pack-qualified references and nothing else (no names, no URLs): names are
 * the library's facts, read from the manifests when the list is shown.
 */

/** Where the list is kept in `localStorage`. */
export const RECENTLY_HEARD_STORAGE_KEY = "sg_recently_heard";

/** How many sounds the list keeps. */
export const RECENTLY_HEARD_LIMIT = 50;

const storedSchema = z.object({
  version: z.literal(1),
  sounds: z.array(z.object({ packId: z.string().min(1), assetId: z.string().min(1) })),
});

/** `sound` heard now: at the top, any earlier hearing of it gone, capped. */
export function rememberHeard(
  heard: readonly SoundKey[],
  sound: SoundKey,
  limit = RECENTLY_HEARD_LIMIT,
): SoundKey[] {
  const reference = { packId: sound.packId, assetId: sound.assetId };
  const rest = heard.filter(
    (entry) => entry.packId !== sound.packId || entry.assetId !== sound.assetId,
  );
  return [reference, ...rest].slice(0, limit);
}

/** Reads the stored list; anything unreadable is an empty list, never an error. */
export function parseRecentlyHeard(raw: string | null): SoundKey[] {
  if (raw === null) return [];
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.sounds.slice(0, RECENTLY_HEARD_LIMIT) : [];
  } catch {
    return [];
  }
}

export function serializeRecentlyHeard(heard: readonly SoundKey[]): string {
  return JSON.stringify({
    version: 1,
    sounds: heard.map(({ packId, assetId }) => ({ packId, assetId })),
  });
}

/** The browser's storage, or `null` where there is none or reading it throws. */
function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export interface RecentlyHeardStore {
  /** The list as stored now, most recent first. */
  load(): SoundKey[];
  /** Records a hearing and returns the list after it. */
  record(sound: SoundKey): SoundKey[];
}

/**
 * The list in this device's storage. Storage that is missing, blocked or full
 * keeps the list for this page only: hearing a sound never fails over it.
 */
export function createRecentlyHeardStore(
  storage: Pick<Storage, "getItem" | "setItem"> | null = deviceStorage(),
): RecentlyHeardStore {
  let memory: SoundKey[] = [];
  // Once a write has failed, this page's list is the one in memory.
  let inMemory = storage === null;
  function load(): SoundKey[] {
    if (inMemory || !storage) return memory;
    try {
      return parseRecentlyHeard(storage.getItem(RECENTLY_HEARD_STORAGE_KEY));
    } catch {
      inMemory = true;
      return memory;
    }
  }
  return {
    load,
    record(sound) {
      const next = rememberHeard(load(), sound);
      memory = next;
      if (!inMemory) {
        try {
          storage?.setItem(RECENTLY_HEARD_STORAGE_KEY, serializeRecentlyHeard(next));
        } catch {
          inMemory = true;
        }
      }
      return next;
    },
  };
}
