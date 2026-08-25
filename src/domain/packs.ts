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
 * 3. **An unavailable pack is reported, never dangling or substituted.**
 *    {@link resolvePackAvailability} answers "can this project's audio be
 *    resolved from the packs I have?" with a report naming the affected tracks
 *    and clips. It never throws and never falls back to another version.
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

export type MissingPackReason =
  /** No version of the pack is available at all. */
  | "pack_unavailable"
  /** The pack is available, but not at the version the project pinned. */
  | "version_unavailable";

/** An entity a missing pack affects, named so a warning can be specific. */
export interface NamedEntity<Id extends string> {
  readonly id: Id;
  readonly name: string;
}

export interface MissingPack {
  readonly packId: PackId;
  /** The version the project depends on, not a version that is available. */
  readonly version: PackVersion;
  readonly reason: MissingPackReason;
  /** Versions of this pack the caller does hold, for an actionable message. */
  readonly availableVersions: readonly PackVersion[];
  readonly assets: readonly NamedEntity<AssetId>[];
  readonly tracks: readonly NamedEntity<TrackId>[];
  readonly clips: readonly NamedEntity<ClipId>[];
}

export interface PackAvailability {
  /** True when every declared pack is available at its declared version. */
  readonly satisfied: boolean;
  readonly missing: readonly MissingPack[];
}

/**
 * Reports which of a project's pack dependencies the given packs cannot satisfy.
 *
 * The contract is deliberately narrow, because invariant 12 rules out the three
 * tempting alternatives: this returns a *report* rather than throwing (a project
 * whose pack is offline still opens, edits, and plays its other tracks), it
 * resolves the exact declared version rather than the nearest available one, and
 * the project's own asset references stay intact rather than being rewritten to
 * something that exists.
 *
 * An affected **track** is one whose instrument — sampler asset or drum pad —
 * resolves from the missing pack. An affected **clip** either references a
 * missing asset in its own audio-loop content, or lives on an affected track,
 * since a note clip cannot sound without its track's instrument.
 */
export function resolvePackAvailability(
  project: Project,
  availablePacks: readonly Pack[],
): PackAvailability {
  const versionsByPack = new Map<string, Set<string>>();
  for (const pack of availablePacks) {
    const versions = versionsByPack.get(pack.id) ?? new Set<string>();
    versions.add(pack.version);
    versionsByPack.set(pack.id, versions);
  }

  const missing: MissingPack[] = [];
  for (const dependency of project.metadata.packDependencies) {
    const available = versionsByPack.get(dependency.packId);
    if (available?.has(dependency.version)) {
      continue;
    }
    const assets = project.song.assets.filter(
      (asset) =>
        asset.packId === dependency.packId && asset.packVersion === dependency.version,
    );
    const affectedTracks = project.song.tracks.filter((track) =>
      trackUsesAssets(track, assets),
    );
    missing.push({
      packId: dependency.packId,
      version: dependency.version,
      reason: available ? "version_unavailable" : "pack_unavailable",
      availableVersions: [...(available ?? [])].sort() as PackVersion[],
      assets: assets.map(named),
      tracks: affectedTracks.map(named),
      clips: affectedClips(project.clips, assets, affectedTracks).map(named),
    });
  }

  return { satisfied: missing.length === 0, missing };
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
