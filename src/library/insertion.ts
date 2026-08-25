import { z } from "zod";
import { addAsset, type RawCommandInput, setSample } from "../commands";
import type { Asset, Project } from "../domain/entities";
import { assetKindSchema, packVersionSchema } from "../domain/entities";
import type { DomainFactoryContext } from "../domain/factories";
import { createAsset } from "../domain/factories";
import { packIdSchema, type TrackId } from "../domain/ids";
import { assetStorageRef, type LibraryAsset } from "./manifest";

/**
 * Putting a library sound into a project (PRD LIB-05, invariant 12).
 *
 * The library's read model and the domain's are deliberately different things:
 * a {@link LibraryAsset} is a row of a pack manifest, complete with the genre
 * and character tags a browser filters on, while a domain `Asset` is the
 * *reference* a project stores — a fresh `ast_` ID, the pack and version it
 * resolved from, and where the audio is delivered. This module is the one
 * crossing between them, so nothing else in the app has to know both shapes.
 *
 * Two things it is careful about:
 *
 * - **A dropped sound is described, not trusted.** {@link librarySampleSchema}
 *   is the payload a drag carries, and it is parsed on the way out of the drop
 *   rather than cast. A `dataTransfer` can be written by any page the user drags
 *   from, so the only safe assumption is that its contents are input.
 * - **The same sound twice is the same asset.** A project that already carries
 *   this pack's delivery of this sound reuses it, so dropping a hat on four
 *   tracks leaves one asset behind rather than four identical ones — which is
 *   also what keeps the buffer cache resolving one entry (`AudioBufferCache`
 *   keys on asset identity).
 */

/**
 * The facts a project needs to carry a library sound — and nothing else. The
 * browsing facets (genres, characters, role) are the library's, not the
 * project's, so they deliberately do not travel.
 */
export const librarySampleSchema = z.strictObject({
  name: z.string().min(1),
  packId: packIdSchema,
  packVersion: packVersionSchema,
  kind: assetKindSchema,
  storageRef: z.string().min(1),
  url: z.string().min(1),
  durationSeconds: z.number().min(0).nullable(),
  sampleRate: z.int().min(1).nullable(),
  channelCount: z.int().min(1).max(2).nullable(),
  licence: z.string().min(1),
});
export type LibrarySample = z.infer<typeof librarySampleSchema>;

/** Licence recorded when a manifest states none, so provenance is never blank. */
const UNSTATED_LICENCE = "unstated";

/**
 * The insertable form of a browsed asset, or `null` when it cannot be loaded
 * onto an instrument at all.
 *
 * A preset carries no master audio (`files.master` is absent), so it has
 * nothing for a sampler to play. Refusing it here is what stops a preset being
 * dropped onto a sampler and becoming an asset whose buffer never resolves.
 */
export function toLibrarySample(asset: LibraryAsset): LibrarySample | null {
  if (!asset.storageKey || !asset.url) return null;
  const parsed = librarySampleSchema.safeParse({
    name: asset.name,
    packId: asset.packId,
    packVersion: asset.packVersion,
    kind: asset.type === "loop" ? "loop" : "sample",
    storageRef: assetStorageRef(asset.storageKey),
    url: asset.url,
    durationSeconds: asset.durationSeconds,
    sampleRate: asset.sampleRate,
    channelCount: asset.channelCount,
    licence: asset.licence ?? UNSTATED_LICENCE,
  });
  return parsed.success ? parsed.data : null;
}

/** The project's own reference to this delivery of this sound, if it has one. */
export function carriedAsset(project: Project, sample: LibrarySample): Asset | null {
  return (
    project.song.assets.find(
      (asset) =>
        asset.packId === sample.packId &&
        asset.packVersion === sample.packVersion &&
        asset.storageRef === sample.storageRef,
    ) ?? null
  );
}

/** A fresh project-scoped reference to a library sound. */
export function createLibraryAsset(
  context: DomainFactoryContext,
  sample: LibrarySample,
): Asset {
  return createAsset(context, {
    pack: { id: sample.packId, version: sample.packVersion },
    name: sample.name,
    kind: sample.kind,
    storageRef: sample.storageRef,
    url: sample.url,
    durationSeconds: sample.durationSeconds,
    sampleRate: sample.sampleRate,
    channelCount: sample.channelCount,
    // The sound came out of a pack manifest, not out of this project, and its
    // rights position travels with it.
    source: "library",
    licence: sample.licence,
  });
}

/**
 * The commands that load a library sound onto a track's sampler, as one
 * transaction: carry the asset if the project does not already, then point the
 * sampler at it.
 *
 * One transaction is the point — it is one revision, one history entry, and one
 * undo, so a drop never leaves an orphaned asset behind if the user takes it
 * back. `instrument.setSample` refuses a track whose instrument is not a
 * sampler, which makes the whole transaction fail and the project unchanged.
 */
export function loadSampleCommands(
  project: Project,
  trackId: TrackId,
  sample: LibrarySample,
  context: DomainFactoryContext,
): readonly RawCommandInput[] {
  const existing = carriedAsset(project, sample);
  if (existing) {
    return [setSample(trackId, existing.id)];
  }
  const asset = createLibraryAsset(context, sample);
  return [addAsset(asset), setSample(trackId, asset.id)];
}
