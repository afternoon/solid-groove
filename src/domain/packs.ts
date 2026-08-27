import type {
  Asset,
  Clip,
  Pack,
  PackDependency,
  PackVersion,
  Project,
  Song,
  Track,
} from "./entities";
import type { AssetId, ClipId, PackId, TrackId } from "./ids";

/**
 * The pack model (PRD LIB-05, section 9.4, invariant 12).
 *
 * Three rules, and this module owns all three:
 *
 * 1. **Asset identity is pack-qualified.** An `Asset` names its owning pack and
 *    the pack version it resolved from, so two packs can hold a sound of the
 *    same name without collision.
 * 2. **A project's pack dependencies are derived, not maintained.**
 *    {@link derivePackDependencies} computes them from `song.assets` alone, so
 *    the list on the metadata tier cannot drift from the assets actually
 *    referenced. `checkProjectIntegrity` rejects a project where it has.
 * 3. **Unresolvable audio is reported, never dangling or substituted.**
 *    {@link resolvePackAvailability} answers "can this project's audio be
 *    resolved from the packs I have?" with a report naming the affected tracks
 *    and clips. It never throws. It answers per *asset*, so a pack that has
 *    gained sounds since the project pinned it still resolves, while one that
 *    has lost a sound the project uses reports that asset by name.
 *
 * Nothing here consults a library: every function is a pure read over project
 * state plus, for availability, an explicit list of the packs the caller holds.
 */

// --- Derivation -------------------------------------------------------

/**
 * The packs a song's assets resolve from, deduplicated and in a deterministic
 * order (pack ID, then version).
 *
 * This is the one definition of a project's pack dependencies. Persistence,
 * commands, and the dashboard projection all call it rather than accumulating
 * their own list, which is what "derived from project state rather than
 * maintained by hand" means in practice.
 */
export function derivePackDependencies(song: Song): PackDependency[] {
  const seen = new Map<string, PackDependency>();
  for (const asset of song.assets) {
    const key = `${asset.packId}@${asset.packVersion}`;
    if (!seen.has(key)) {
      seen.set(key, { packId: asset.packId, version: asset.packVersion });
    }
  }
  return [...seen.values()].sort(
    (a, b) => compare(a.packId, b.packId) || compare(a.version as string, b.version),
  );
}

/** Do two dependency lists name the same packs at the same versions? */
export function packDependenciesEqual(
  a: readonly PackDependency[],
  b: readonly PackDependency[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = sortedKeys(a);
  const right = sortedKeys(b);
  return left.every((key, index) => key === right[index]);
}

/**
 * Returns `project` with its metadata pack dependency list recomputed from its
 * song, and its pack shelf (`addedPacks`) reconciled so every derived
 * dependency is shelved at the version it is used at (LIB-08).
 *
 * When both lists are already correct the *same object* comes back, not an
 * equal copy. Every transaction runs this, so preserving identity is what keeps
 * a note edit from looking like a metadata change to the `FND-005` projections.
 *
 * The shelf reconciliation only ever *adds* a used pack that was missing (or
 * corrects its shelved version to the used one); it never removes a shelved
 * pack, because an added-but-unused pack is a legitimate shelf entry the user
 * put there on purpose. Removing a pack from the shelf is the `pack.remove`
 * command's job, not a side effect of an edit.
 */
export function withDerivedPackDependencies(project: Project): Project {
  const derived = derivePackDependencies(project.song);
  const shelf = reconcilePackShelf(project.metadata.addedPacks, derived);
  const dependenciesChanged = !packDependenciesEqual(
    project.metadata.packDependencies,
    derived,
  );
  if (!dependenciesChanged && shelf === project.metadata.addedPacks) {
    return project;
  }
  return {
    ...project,
    metadata: {
      ...project.metadata,
      packDependencies: derived,
      addedPacks: [...shelf],
    },
  };
}

/**
 * Ensures the shelf is a superset of the dependency list at matching versions,
 * preserving added-but-unused entries. Returns the same array object when
 * nothing needs changing, so an unrelated edit does not churn the shelf.
 *
 * Exported because the persistence layer applies it too: when `saveSong`
 * recomputes the derived dependency list from the song it is about to write, it
 * reconciles the stored shelf against that list in the same revision, so the two
 * metadata fields can never disagree on disk.
 */
export function reconcilePackShelf(
  shelf: readonly PackDependency[],
  dependencies: readonly PackDependency[],
): readonly PackDependency[] {
  const byPack = new Map(shelf.map((entry) => [entry.packId, entry]));
  let changed = false;
  for (const dependency of dependencies) {
    const shelved = byPack.get(dependency.packId);
    if (!shelved || shelved.version !== dependency.version) {
      byPack.set(dependency.packId, dependency);
      changed = true;
    }
  }
  if (!changed) {
    return shelf;
  }
  return [...byPack.values()].sort(
    (a, b) => compare(a.packId, b.packId) || compare(a.version as string, b.version),
  );
}

// --- Availability -----------------------------------------------------

/**
 * One pack version the caller holds, together with the assets it contains.
 *
 * Availability is judged per *asset*, not per version string (LIB-10), so the
 * pack record alone cannot answer it: a personal pack grows every time its
 * owner drops a file in, and the pack the project pinned yesterday is the same
 * pack with one more sound in it today. The caller therefore supplies what each
 * version it holds actually contains, and the library — not this module — is
 * where that list comes from.
 */
export interface AvailablePack {
  readonly pack: Pack;
  /** IDs of the assets this pack version contains. */
  readonly assetIds: readonly AssetId[];
}

/**
 * Why a pack could not be resolved. One member today — a pack that is present
 * at *some* version is no longer missing, because the assets a project actually
 * references are looked for across every version the caller holds.
 */
export type MissingPackReason =
  /** No version of the pack is available at all. */
  "pack_unavailable";

/** An entity a missing pack or asset affects, named so a warning can be specific. */
export interface NamedEntity<Id extends string> {
  readonly id: Id;
  readonly name: string;
}

export interface MissingPack {
  readonly packId: PackId;
  /** The version the project depends on, not a version that is available. */
  readonly version: PackVersion;
  readonly reason: MissingPackReason;
  readonly assets: readonly NamedEntity<AssetId>[];
  readonly tracks: readonly NamedEntity<TrackId>[];
  readonly clips: readonly NamedEntity<ClipId>[];
}

/**
 * One asset the project references that no available version of its pack holds
 * any more — the pack is installed, the sound was deleted from it.
 */
export interface MissingAsset {
  readonly assetId: AssetId;
  readonly name: string;
  readonly packId: PackId;
  /** The pack version the project resolved this asset from. */
  readonly version: PackVersion;
  /** Versions of the pack the caller holds, none of which contain the asset. */
  readonly availableVersions: readonly PackVersion[];
  readonly tracks: readonly NamedEntity<TrackId>[];
  readonly clips: readonly NamedEntity<ClipId>[];
}

export interface PackAvailability {
  /** True when no pack and no referenced asset is missing. */
  readonly satisfied: boolean;
  /** Packs the caller holds at no version at all. */
  readonly missing: readonly MissingPack[];
  /** Assets deleted from every version of a pack the caller does hold. */
  readonly missingAssets: readonly MissingAsset[];
}

/**
 * Reports what of a project's audio the given packs cannot resolve.
 *
 * Resolution is **per asset** (LIB-10): a dependency is satisfied when every
 * asset the project references from that pack is present in some version of it
 * the caller holds. A pack version that gained sounds since the project pinned
 * it therefore resolves silently — which is the common case for a personal pack
 * — while a sound *deleted* from the pack is reported loudly, named, with the
 * tracks and clips that use it. LIB-05 still holds either way: an asset is
 * immutable content, so finding it in a later version returns the same audio,
 * and the project keeps recording the version it resolved from. Nothing here
 * rewrites project state, upgrades a pinned version, or adopts a later version's
 * metadata for an asset.
 *
 * The contract stays deliberately narrow otherwise: this returns a *report*
 * rather than throwing (a project whose pack is offline still opens, edits, and
 * plays its other tracks), and it never substitutes a different sound for one
 * that has gone.
 *
 * An affected **track** is one whose instrument — sampler asset or drum pad —
 * resolves from the missing pack or asset. An affected **clip** either
 * references a missing asset in its own audio-loop content, or lives on an
 * affected track, since a note clip cannot sound without its track's instrument.
 */
export function resolvePackAvailability(
  project: Project,
  availablePacks: readonly AvailablePack[],
): PackAvailability {
  const held = indexAvailablePacks(availablePacks);

  const missing: MissingPack[] = [];
  const missingAssets: MissingAsset[] = [];
  for (const dependency of project.metadata.packDependencies) {
    const holding = held.get(dependency.packId);
    const assets = project.song.assets.filter(
      (asset) =>
        asset.packId === dependency.packId && asset.packVersion === dependency.version,
    );

    if (!holding) {
      missing.push({
        packId: dependency.packId,
        version: dependency.version,
        reason: "pack_unavailable",
        assets: assets.map(named),
        ...affected(project, assets),
      });
      continue;
    }

    for (const asset of assets) {
      if (holding.assetIds.has(asset.id)) {
        continue;
      }
      missingAssets.push({
        assetId: asset.id,
        name: asset.name,
        packId: dependency.packId,
        version: dependency.version,
        availableVersions: [...holding.versions].sort() as PackVersion[],
        ...affected(project, [asset]),
      });
    }
  }

  return {
    satisfied: missing.length === 0 && missingAssets.length === 0,
    missing,
    missingAssets,
  };
}

interface HeldPack {
  /** Every version of this pack the caller holds. */
  readonly versions: Set<string>;
  /** The union of the assets those versions contain. */
  readonly assetIds: Set<string>;
}

function indexAvailablePacks(
  availablePacks: readonly AvailablePack[],
): Map<string, HeldPack> {
  const held = new Map<string, HeldPack>();
  for (const entry of availablePacks) {
    const existing = held.get(entry.pack.id) ?? {
      versions: new Set<string>(),
      assetIds: new Set<string>(),
    };
    existing.versions.add(entry.pack.version);
    for (const assetId of entry.assetIds) {
      existing.assetIds.add(assetId);
    }
    held.set(entry.pack.id, existing);
  }
  return held;
}

/** The tracks and clips a set of unresolvable assets takes down with it. */
function affected(
  project: Project,
  assets: readonly Asset[],
): {
  tracks: readonly NamedEntity<TrackId>[];
  clips: readonly NamedEntity<ClipId>[];
} {
  const tracks = project.song.tracks.filter((track) => trackUsesAssets(track, assets));
  return {
    tracks: tracks.map(named),
    clips: affectedClips(project.clips, assets, tracks).map(named),
  };
}

/** Every asset ID a track's instrument resolves, sampler or drum pad. */
export function trackAssetIds(track: Track): AssetId[] {
  const instrument = track.instrument;
  if (!instrument) {
    return [];
  }
  if (instrument.kind === "sampler") {
    return instrument.assetId ? [instrument.assetId] : [];
  }
  if (instrument.kind === "drumMachine") {
    return instrument.pads.flatMap((pad) => (pad.assetId ? [pad.assetId] : []));
  }
  return [];
}

function trackUsesAssets(track: Track, assets: readonly Asset[]): boolean {
  const ids = new Set(assets.map((asset) => asset.id));
  return trackAssetIds(track).some((assetId) => ids.has(assetId));
}

function affectedClips(
  clips: readonly Clip[],
  assets: readonly Asset[],
  affectedTracks: readonly Track[],
): Clip[] {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const trackIds = new Set(affectedTracks.map((track) => track.id));
  return clips.filter(
    (clip) =>
      trackIds.has(clip.trackId) ||
      (clip.content.kind === "audioLoop" && assetIds.has(clip.content.assetId)),
  );
}

function named<Id extends string>(entity: { id: Id; name: string }): NamedEntity<Id> {
  return { id: entity.id, name: entity.name };
}

function sortedKeys(dependencies: readonly PackDependency[]): string[] {
  return dependencies
    .map((dependency) => `${dependency.packId}@${dependency.version}`)
    .sort();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
