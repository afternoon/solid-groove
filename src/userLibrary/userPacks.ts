import { z } from "zod";
import { packVersion } from "../domain/entities";
import { type AssetId, assetIdSchema, type PackId, packIdSchema } from "../domain/ids";
import type { AvailablePack } from "../domain/packs";
import {
  type LibraryAsset,
  type LibraryPackSummary,
  WAVEFORM_PEAK_COUNT,
} from "../library/manifest";

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
 * {@link userPackHoldings}). Renaming the pack moves nothing: a name is not
 * content.
 */

export const USER_PACK_SCHEMA_VERSION = 1;

/** The name "Add pack" gives a pack until its owner types one. */
export const DEFAULT_PACK_NAME = "New pack";

/** The pack a drop on empty space creates and imports into. */
export const DROP_PACK_NAME = "My Sounds";

/** A pack name's length limit, matching `firestore.rules`. */
export const MAX_PACK_NAME_LENGTH = 80;

/** The licence a user's own sound is recorded under: theirs, not ours. */
export const USER_CONTENT_LICENCE = "user-owned";

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

/** One imported sound, as its pack document stores it. */
export const userPackAssetSchema = z.strictObject({
  id: assetIdSchema,
  name: z.string().min(1).max(120),
  type: z.enum(["one-shot", "loop"]),
  family: z.string().min(1),
  role: z.string().min(1),
  /** Where the audio lives in Cloud Storage. */
  storagePath: z.string().min(1),
  /** The download URL the browser decodes it from. */
  url: z.string().min(1),
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
  assets: z.array(userPackAssetSchema),
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

/** A typed pack name, trimmed and capped, or `null` when nothing is left. */
export function cleanPackName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_PACK_NAME_LENGTH).trim();
  return name === "" ? null : name;
}

/** The pack with its name changed; the version stays, since no sound changed. */
export function renamePack(pack: UserPack, name: string, now: number): UserPack {
  const cleaned = cleanPackName(name);
  if (cleaned === null || cleaned === pack.name) return pack;
  return { ...pack, name: cleaned, modifiedAt: now };
}

type Bump = "major" | "minor";

function bump(version: string, part: Bump): string {
  const [major, minor] = version.split(".").map(Number);
  return part === "major" ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
}

/** The asset as it will be stored, before the version it lands in is known. */
export type NewUserPackAsset = Omit<UserPackAsset, "addedInVersion">;

/** The pack with one more sound, at the next minor version. */
export function addSound(pack: UserPack, asset: NewUserPackAsset, now: number): UserPack {
  const version = bump(pack.version, "minor");
  return {
    ...pack,
    version,
    assets: [...pack.assets, { ...asset, addedInVersion: version }],
    modifiedAt: now,
  };
}

/** The pack without one sound, at the next major version; unchanged if it was not there. */
export function removeSound(pack: UserPack, assetId: string, now: number): UserPack {
  if (!pack.assets.some((asset) => asset.id === assetId)) return pack;
  return {
    ...pack,
    version: bump(pack.version, "major"),
    assets: pack.assets.filter((asset) => asset.id !== assetId),
    modifiedAt: now,
  };
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
    url: asset.url,
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
 * The pack as `resolvePackAvailability` reads it: the version the owner holds
 * and every sound in it. Sounds are only ever added to a version or removed
 * from one, so this current version holds every sound any earlier version did
 * unless it was deleted — which is what lets a project pinned to 1.0.0 resolve
 * against 1.3.0, and what reports a deleted sound as missing.
 */
export function userPackHoldings(pack: UserPack): AvailablePack {
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
    assetIds: pack.assets.map((asset) => asset.id as AssetId),
  };
}
