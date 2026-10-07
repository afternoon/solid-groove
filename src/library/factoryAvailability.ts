import type { Pack, PackVersion, Project } from "../domain/entities";
import {
  type AvailablePack,
  type MissingPack,
  resolvePackAvailability,
} from "../domain/packs";
import { assetStorageRef, type LibraryPackSummary } from "./manifest";

/**
 * The factory packs a project depends on that the published library has
 * withdrawn (#78; sample-library section 17: "an unavailable pack is reported
 * with its affected tracks and clips rather than breaking playback or
 * export").
 *
 * A factory pack is withdrawn when the pack index no longer lists it at any
 * version. That is the only way a factory sound goes missing: audio is
 * content-addressed and every pack version's manifest is immutable, so a sound
 * dropped from a pack's *latest* version has only left new-project discovery.
 * The project still names the exact bytes it resolved, those bytes are still
 * delivered, and it is not reported. A pack the index still lists therefore
 * holds every sound the project uses from it, whichever version it pins.
 *
 * Only factory deliveries are judged: a pack whose sounds are stored under the
 * library's audio root. Personal sounds (#282) resolve against their owner's
 * own packs (`userPackAvailability`), never the factory index, and anything
 * else (a prototype path, a test fixture) was never the library's to withdraw.
 *
 * Like `resolvePackAvailability`, this only reports. The project keeps its
 * assets, its pinned versions and its provenance (licence and attribution
 * included), so the sound comes back unchanged if the pack is restored.
 */
export function withdrawnFactoryPacks(
  project: Project,
  index: readonly LibraryPackSummary[],
): readonly MissingPack[] {
  const factory = new Set(
    project.song.assets
      .filter((asset) => isLibraryDelivery(asset.storageRef))
      .map((asset) => asset.packId as string),
  );
  const listed = new Map(index.map((summary) => [summary.id, summary]));

  const held: AvailablePack[] = [];
  for (const dependency of project.metadata.packDependencies) {
    const summary = listed.get(dependency.packId);
    if (!summary || !factory.has(dependency.packId)) continue;
    held.push({
      pack: listedPack(summary, dependency.version),
      assetIds: project.song.assets
        .filter((asset) => asset.packId === dependency.packId)
        .map((asset) => asset.id),
    });
  }

  return resolvePackAvailability(project, held).missing.filter((entry) =>
    factory.has(entry.packId),
  );
}

/** Is this storage reference a sound the factory library delivers? */
function isLibraryDelivery(storageRef: string): boolean {
  return storageRef.startsWith(assetStorageRef(""));
}

/**
 * The pack as availability reads it. Only its id and version are consulted;
 * the index carries no rights position, and none is invented for anything to
 * act on, so the rights here are the most restrictive ones.
 */
function listedPack(summary: LibraryPackSummary, pinned: PackVersion): Pack {
  return {
    id: summary.id as Pack["id"],
    name: summary.name,
    version: pinned,
    publisher: summary.publisher,
    kind: summary.kind,
    description: summary.description,
    rights: { licence: "unstated", rawRedistribution: false, attributionRequired: true },
  };
}
