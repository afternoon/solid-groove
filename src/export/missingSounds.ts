import type { Analytics } from "../analytics/analytics";
import type { Project } from "../domain/entities";

/**
 * Exporting a project with sounds it has reported missing (#78): a personal
 * sound gone from its pack, or a sound in a withdrawn library pack. The export
 * renders around any of them that cannot load rather than failing, so a
 * producer can still take the rest of the song away; these are the analytics
 * that say how often that happens. Only a count travels, never which sounds.
 */

/** How many of the project's sounds are in `missingAssetIds`. */
export function missingSoundCount(
  project: Project,
  missingAssetIds: ReadonlySet<string> | undefined,
): number {
  if (!missingAssetIds || missingAssetIds.size === 0) return 0;
  return project.song.assets.filter((asset) => missingAssetIds.has(asset.id)).length;
}

/**
 * `export_started`'s `missing_sound_count`, present only when there is one, and
 * the first export of a project with missing sounds marked as a first use.
 * Call once per export, where `export_started` is logged.
 */
export function missingSoundsAtStart(
  analytics: Pick<Analytics, "logFeatureFirstUse"> | undefined,
  project: Project,
  missingAssetIds: ReadonlySet<string> | undefined,
): { missing_sound_count?: number } {
  const count = missingSoundCount(project, missingAssetIds);
  if (count === 0) return {};
  analytics?.logFeatureFirstUse("export_with_missing_sounds");
  return { missing_sound_count: count };
}
