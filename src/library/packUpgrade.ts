import type { PackVersion, Project } from "../domain/entities";
import type { PackId } from "../domain/ids";
import type { LibraryClient } from "./libraryClient";
import { assetStorageRef } from "./manifest";

/**
 * Taking a sound from a newer version of a pack the project already pins
 * (#892).
 *
 * A project resolves one version per pack (invariant 12), so a sound from P@N
 * can only join a project pinned to P@O by moving the pin: `pack.setVersion`,
 * in the same transaction as the insert (`./insertion` prepends it). Whether
 * that is safe is decided here, against the newer version's manifest:
 *
 * - **Safe** when every sound the project uses from P is also in P@N. Sounds
 *   are content-addressed (`storageRef` is a SHA-256 path) and immutable, so
 *   the same `storageRef` in P@N is the same audio, and the upgrade changes
 *   nothing anyone can hear. The insert upgrades without asking.
 * - **Unsafe** when at least one is not. The upgrade would leave those sounds
 *   in the missing-sound state `resolvePackAvailability` reports — never
 *   deleted, never substituted — so the producer chooses.
 */

/** One pack's pin, moving from the version the project holds to a newer one. */
export interface PackUpgrade {
  readonly packId: PackId;
  readonly from: PackVersion;
  readonly to: PackVersion;
}

/** The version the project pins a pack at: its assets', else its shelf's. */
export function pinnedPackVersion(project: Project, packId: PackId): PackVersion | null {
  const asset = project.song.assets.find((entry) => entry.packId === packId);
  if (asset) return asset.packVersion;
  return (
    project.metadata.addedPacks.find((entry) => entry.packId === packId)?.version ?? null
  );
}

/**
 * The upgrade inserting a sound from `sample`'s pack version needs, or `null`
 * when the project does not use that pack yet or already pins this version.
 */
export function packUpgradeFor(
  project: Project,
  sample: { readonly packId: PackId; readonly packVersion: PackVersion },
): PackUpgrade | null {
  const from = pinnedPackVersion(project, sample.packId);
  if (from === null || from === sample.packVersion) return null;
  return { packId: sample.packId, from, to: sample.packVersion };
}

/**
 * How many of the project's sounds from the upgraded pack are not in the
 * newer version, given the storage refs that version delivers.
 */
export function soundsMissingAfterUpgrade(
  project: Project,
  upgrade: PackUpgrade,
  delivered: ReadonlySet<string>,
): number {
  return project.song.assets.filter(
    (asset) => asset.packId === upgrade.packId && !delivered.has(asset.storageRef),
  ).length;
}

/**
 * The storage refs one pack version delivers, read from its manifest, or
 * `null` when the index does not list that version or it cannot be loaded.
 */
export async function deliveredStorageRefs(
  client: LibraryClient,
  packId: PackId,
  version: PackVersion,
): Promise<ReadonlySet<string> | null> {
  const index = await client.loadIndex().catch(() => null);
  const summary = index?.find((pack) => pack.id === packId && pack.version === version);
  if (!summary) return null;
  const loaded = await client.loadPack(summary);
  if (!loaded.ok) return null;
  return new Set(
    loaded.assets.flatMap((asset) =>
      asset.storageKey ? [assetStorageRef(asset.storageKey)] : [],
    ),
  );
}

/** What inserting a sound would do to its pack's pin. */
export type PackUpgradeCheck =
  /** No upgrade: the pack is new to the project, or already at this version. */
  | { readonly kind: "none" }
  /** Every sound the project uses from the pack is in the newer version. */
  | { readonly kind: "safe"; readonly upgrade: PackUpgrade }
  /**
   * Some would go missing. `missing` is how many, or `null` when the newer
   * version's manifest could not be read to count them.
   */
  | {
      readonly kind: "unsafe";
      readonly upgrade: PackUpgrade;
      readonly missing: number | null;
    };

/** Decides whether inserting `sample` upgrades its pack, and whether safely. */
export async function checkPackUpgrade(
  project: Project,
  sample: { readonly packId: PackId; readonly packVersion: PackVersion },
  client: LibraryClient,
): Promise<PackUpgradeCheck> {
  const upgrade = packUpgradeFor(project, sample);
  if (!upgrade) return { kind: "none" };
  const delivered = await deliveredStorageRefs(client, upgrade.packId, upgrade.to);
  if (!delivered) return { kind: "unsafe", upgrade, missing: null };
  const missing = soundsMissingAfterUpgrade(project, upgrade, delivered);
  return missing === 0 ? { kind: "safe", upgrade } : { kind: "unsafe", upgrade, missing };
}
