/**
 * How a personal pack's version moves when its sounds do (#282), over the
 * least of a pack document's shape, so the browser (`src/userLibrary`) and the
 * Cloud Function (`functions/src/index.ts`) take a sound out the same way.
 *
 * Adding a sound is a minor version: a project pinned to an earlier one still
 * resolves everything it used. Removing one is a major version: a project that
 * used it now reports it missing.
 */

/** What a version bump reads and writes of a pack document. */
export interface VersionedPack {
  readonly version: string;
  readonly assets: readonly { readonly id: string }[];
  readonly modifiedAt: number;
}

export type VersionBump = "major" | "minor";

/** `version` one step on: `2.3.1` becomes `3.0.0` (major) or `2.4.0` (minor). */
export function bumpVersion(version: string, part: VersionBump): string {
  const [major, minor] = version.split(".").map(Number);
  return part === "major" ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
}

/** The pack without one sound, at the next major version; unchanged if it was not there. */
export function withoutSound<T extends VersionedPack>(
  pack: T,
  assetId: string,
  now: number,
): T {
  if (!pack.assets.some((asset) => asset.id === assetId)) return pack;
  return {
    ...pack,
    version: bumpVersion(pack.version, "major"),
    assets: pack.assets.filter((asset) => asset.id !== assetId),
    modifiedAt: now,
  };
}
