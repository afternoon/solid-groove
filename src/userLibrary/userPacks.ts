import { z } from "zod";
import type { Project } from "../domain/entities";
import { packVersion } from "../domain/entities";
import { assetIdSchema, type PackId, packIdSchema } from "../domain/ids";
import {
  type AvailablePack,
  type MissingAsset,
  type MissingPack,
  resolvePackAvailability,
} from "../domain/packs";
import {
  type LibraryAsset,
  type LibraryPackSummary,
  WAVEFORM_PEAK_COUNT,
} from "../library/manifest";
import { bumpVersion, withoutSound } from "../userData/packVersions";
import { MAX_PACK_SOUNDS, parseUserDataPath } from "../userData/userData";

/**
 * A producer's own packs (#282; PRD LIB-03, LIB-05 `kind: "user"`).
 *
 * A personal pack is a pack like any other — a name, a `major.minor.patch`
 * version, and sounds with pack-qualified IDs — so the browser, search,
 * audition and insertion read its sounds as ordinary {@link LibraryAsset}s and
 * never learn a second content model. What is different is where it comes
 * from: one Firestore document per pack under the owner
 * (`users/{uid}/packs/{packId}`), its audio in Cloud Storage beside it
 * (`src/userData/userData.ts`), rather than a published manifest.
 *
 * Versions move with content. Adding a sound is a minor version (a project
 * pinned to an earlier one still resolves every sound it uses, since nothing
 * it used has gone); deleting one is a major version (a project that used it
 * now reports it missing, by name, with its tracks and clips — see
 * {@link userPackHoldings}). Renaming the pack or one of its sounds moves
 * nothing: a name is not content.
 */

export const USER_PACK_SCHEMA_VERSION = 1;

/** The name "Add pack" gives a pack until its owner types one. */
export const DEFAULT_PACK_NAME = "New pack";

/** The pack a drop on empty space creates and imports into. */
export const DROP_PACK_NAME = "My Sounds";

/** A pack name's length limit, matching `firestore.rules`. */
export const MAX_PACK_NAME_LENGTH = 80;

/** A sound name's length limit. */
export const MAX_SOUND_NAME_LENGTH = 120;

/** The licence a user's own sound is recorded under: theirs, not ours. */
export const USER_CONTENT_LICENCE = "user-owned";

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

/** One imported sound, as its pack document stores it. */
export const userPackAssetSchema = z.strictObject({
  id: assetIdSchema,
  name: z.string().min(1).max(MAX_SOUND_NAME_LENGTH),
  type: z.enum(["one-shot", "loop"]),
  family: z.string().min(1),
  role: z.string().min(1),
  /**
   * Where the audio lives in Cloud Storage, and the only way to it. There is
   * deliberately no download URL: one is a bearer token, and a pack's sounds
   * travel into projects other people can read (#282). The owner's browser
   * reads the bytes at this path as the owner instead.
   */
  storagePath: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  durationSeconds: z.number().min(0),
  sampleRate: z.number().int().min(1).nullable(),
  channelCount: z.number().int().min(1).nullable(),
  bpm: z.number().min(1).nullable(),
  peaks: z.array(z.number().int().min(0).max(255)).length(WAVEFORM_PEAK_COUNT).nullable(),
  /** The pack version this sound first appeared in. */
  addedInVersion: versionSchema,
  createdAt: z.number().int().min(0),
});
export type UserPackAsset = z.infer<typeof userPackAssetSchema>;

/** One personal pack document. */
export const userPackSchema = z.strictObject({
  schemaVersion: z.literal(USER_PACK_SCHEMA_VERSION),
  id: packIdSchema,
  kind: z.literal("user"),
  name: z.string().min(1).max(MAX_PACK_NAME_LENGTH),
  version: versionSchema,
  assets: z.array(userPackAssetSchema).max(MAX_PACK_SOUNDS),
  createdAt: z.number().int().min(0),
  modifiedAt: z.number().int().min(0),
});
export type UserPack = z.infer<typeof userPackSchema>;

/** Parse a stored pack, or `null` when it is not one this app can read. */
export function parseUserPack(value: unknown): UserPack | null {
  const result = userPackSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** A fresh, empty pack at version 1.0.0. */
export function newUserPack(id: PackId, name: string, now: number): UserPack {
  return {
    schemaVersion: USER_PACK_SCHEMA_VERSION,
    id,
    kind: "user",
    name: cleanPackName(name) ?? DEFAULT_PACK_NAME,
    version: "1.0.0",
    assets: [],
    createdAt: now,
    modifiedAt: now,
  };
}

/** A typed name, trimmed and capped at `limit`, or `null` when nothing is left. */
function cleanName(raw: string, limit: number): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, limit).trim();
  return name === "" ? null : name;
}

/** A typed pack name, trimmed and capped, or `null` when nothing is left. */
export function cleanPackName(raw: string): string | null {
  return cleanName(raw, MAX_PACK_NAME_LENGTH);
}

/** A typed sound name, trimmed and capped, or `null` when nothing is left. */
export function cleanSoundName(raw: string): string | null {
  return cleanName(raw, MAX_SOUND_NAME_LENGTH);
}

/** The pack with its name changed; the version stays, since no sound changed. */
export function renamePack(pack: UserPack, name: string, now: number): UserPack {
  const cleaned = cleanPackName(name);
  if (cleaned === null || cleaned === pack.name) return pack;
  return { ...pack, name: cleaned, modifiedAt: now };
}

/**
 * The pack with one sound renamed. The version stays: the audio is the same,
 * and a project that already uses the sound keeps the name it was inserted
 * under. Unchanged when the sound is not there or the name is empty or the same.
 */
export function renameSound(
  pack: UserPack,
  assetId: string,
  name: string,
  now: number,
): UserPack {
  const cleaned = cleanSoundName(name);
  const current = pack.assets.find((asset) => asset.id === assetId);
  if (!current || cleaned === null || cleaned === current.name) return pack;
  return {
    ...pack,
    assets: pack.assets.map((asset) =>
      asset.id === assetId ? { ...asset, name: cleaned } : asset,
    ),
    modifiedAt: now,
  };
}

/** Whether a pack has room for another sound (`MAX_PACK_SOUNDS`, in `firestore.rules` too). */
export function packHasRoom(soundCount: number): boolean {
  return soundCount < MAX_PACK_SOUNDS;
}

/** The asset as it will be stored, before the version it lands in is known. */
export type NewUserPackAsset = Omit<UserPackAsset, "addedInVersion">;

/** The pack with one more sound, at the next minor version. */
export function addSound(pack: UserPack, asset: NewUserPackAsset, now: number): UserPack {
  const version = bumpVersion(pack.version, "minor");
  return {
    ...pack,
    version,
    assets: [...pack.assets, { ...asset, addedInVersion: version }],
    modifiedAt: now,
  };
}

/** The pack without one sound, at the next major version; unchanged if it was not there. */
export function removeSound(pack: UserPack, assetId: string, now: number): UserPack {
  return withoutSound(pack, assetId, now);
}

// ---------------------------------------------------------------------------
// The browser's read model
// ---------------------------------------------------------------------------

/**
 * The pack as the library lists it. A personal pack has no manifest to fetch
 * and no published slug, so its slug is its ID (never logged: analytics
 * reports every user pack as `"user"`, see `packAnalyticsIdentity`).
 */
export function userPackSummary(pack: UserPack): LibraryPackSummary {
  return {
    id: pack.id,
    slug: pack.id,
    name: pack.name,
    version: pack.version,
    publisher: "You",
    kind: "user",
    description: "",
    assetCount: pack.assets.length,
    manifestPath: "",
  };
}

/** The pack's sounds as library assets: searchable, auditionable, insertable. */
export function userPackAssets(pack: UserPack): LibraryAsset[] {
  return pack.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    family: asset.family,
    role: asset.role,
    genres: [],
    characters: [],
    packId: pack.id,
    packSlug: pack.id,
    packName: pack.name,
    packVersion: pack.version,
    // No URL: the audio is read from `storageRef` as its owner, never fetched
    // from a link that would work for anyone holding it.
    url: null,
    storageKey: null,
    storageRef: asset.storagePath,
    licence: USER_CONTENT_LICENCE,
    durationSeconds: asset.durationSeconds,
    sampleRate: asset.sampleRate,
    channelCount: asset.channelCount,
    bpm: asset.bpm,
    bars: null,
    peaks: asset.peaks,
  }));
}

/**
 * The pack as `resolvePackAvailability` reads it for one project: the version
 * the owner holds and which of the project's sounds it still has. Sounds are
 * only ever added to a version or removed from one, so this current version
 * holds every sound any earlier version did unless it was deleted — which is
 * what lets a project pinned to 1.0.0 resolve against 1.3.0, and what reports
 * a deleted sound as missing.
 *
 * A project names its sounds with IDs of its own, not the pack's, so they are
 * matched by where the audio is stored: a stored sound's path is unique to it
 * and never reused.
 */
export function userPackHoldings(pack: UserPack, project: Project): AvailablePack {
  const stored = new Set(pack.assets.map((asset) => asset.storagePath));
  return {
    pack: {
      id: pack.id,
      name: pack.name,
      version: packVersion(pack.version),
      publisher: "You",
      kind: "user",
      description: "",
      rights: {
        licence: USER_CONTENT_LICENCE,
        rawRedistribution: false,
        attributionRequired: false,
      },
    },
    assetIds: project.song.assets
      .filter((asset) => asset.packId === pack.id && stored.has(asset.storageRef))
      .map((asset) => asset.id),
  };
}

/** What of a project's personal sounds the owner's packs no longer hold. */
export interface UserSoundAvailability {
  /** Sounds deleted from a pack the owner still has. */
  readonly missingAssets: readonly MissingAsset[];
  /** Packs the owner no longer has at all, with the sounds they took along. */
  readonly missingPacks: readonly MissingPack[];
}

/**
 * Resolves a project's personal sounds against the signed-in owner's packs
 * (#282): the report a deleted sound leaves behind, naming the tracks and
 * clips it took down. Only `kind: "user"` packs are judged — a dependency is
 * one when its sounds are stored under `users/` — since factory packs resolve
 * through the library, not here. And only `owner`'s: a collaborator's
 * personal sound is not in this user's packs, and is not theirs to report.
 */
export function userPackAvailability(
  project: Project,
  packs: readonly UserPack[],
  owner: string,
): UserSoundAvailability {
  const personal = new Set(
    project.song.assets
      .filter((asset) => parseUserDataPath(asset.storageRef)?.uid === owner)
      .map((asset) => asset.packId as string),
  );
  if (personal.size === 0) return { missingAssets: [], missingPacks: [] };
  const report = resolvePackAvailability(
    project,
    packs.map((pack) => userPackHoldings(pack, project)),
  );
  return {
    missingAssets: report.missingAssets.filter((entry) => personal.has(entry.packId)),
    missingPacks: report.missing.filter((entry) => personal.has(entry.packId)),
  };
}
