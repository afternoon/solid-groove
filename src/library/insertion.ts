import { z } from "zod";
import { addAsset, addTrack, type RawCommandInput, setSample } from "../commands";
import type { Asset, Project } from "../domain/entities";
import { assetKindSchema, packVersionSchema } from "../domain/entities";
import type { DomainFactoryContext } from "../domain/factories";
import {
  createAsset,
  createAudioLoopClip,
  createPlacement,
  createTrack,
} from "../domain/factories";
import { packIdSchema, type TrackId } from "../domain/ids";
import { SONG_TEMPO } from "../domain/parameters";
import { TICKS_PER_BAR, TICKS_PER_QUARTER } from "../domain/time";
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
  /**
   * The tempo the loop was recorded at, when the manifest states one. It is
   * what an `audioLoop` clip stores as its `sourceTempo`, and therefore what
   * decides the stretch ratio at playback — a loop that states nothing plays
   * unstretched rather than guessing (see {@link insertLoopCommands}).
   *
   * Absent and `null` mean the same thing, so a payload written before this
   * field existed still parses. This shape travels on a `DataTransfer` that a
   * drag begun in another tab may have written, so a field added here must
   * never turn an otherwise valid drop into a refusal.
   */
  bpm: z
    .number()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  /**
   * How many bars the loop declares it spans, when the manifest says. It is
   * the clip's length (see {@link loopClipLengthTicks}); absent means the same
   * as `null`, for the same drag-compatibility reason as `bpm`.
   */
  bars: z
    .number()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
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
    bpm: asset.bpm,
    bars: asset.bars,
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

/** What a loop insertion needs to know about the project it is landing in. */
export interface InsertLoopOptions {
  /** The new track's position: the number of tracks the song already has. */
  readonly order: number;
  /** Names already taken, so the new track is distinguishable. */
  readonly existingNames: readonly string[];
  /** The song's tempo, used to size the clip and as the fallback source tempo. */
  readonly songTempo: number;
}

/**
 * How long the loop's clip is, in ticks, in whole bars.
 *
 * A loop is musical material, so its clip is sized in bars rather than in the
 * seconds the file happens to occupy: a 2-bar loop stays 2 bars whatever tempo
 * the song is at, which is the whole point of following the tempo.
 *
 * The bar count the manifest **declares** is the authority — the library
 * builder cut the file to exactly that many bars (`verifyGrid`), so it is the
 * one fact that cannot drift. A loop that declares none is measured instead,
 * from its duration at its *own* tempo — the timebase its samples are in, not
 * the song's.
 *
 * Anything that cannot be derived falls back to one bar. A loop that states no
 * tempo, or no duration, is not a reason to refuse it; it is a reason not to
 * pretend to know how long it is.
 */
export function loopClipLengthTicks(sample: LibrarySample): number {
  const { durationSeconds, bpm, bars: declared } = sample;
  if (declared) return Math.max(1, Math.round(declared)) * TICKS_PER_BAR;
  if (!durationSeconds || !bpm) return TICKS_PER_BAR;
  const beats = (durationSeconds * bpm) / 60;
  const bars = Math.round((beats * TICKS_PER_QUARTER) / TICKS_PER_BAR);
  return Math.max(1, bars) * TICKS_PER_BAR;
}

/**
 * The commands that bring a library **loop** into a project as a new track, as
 * one transaction: carry the asset if the project does not already, then add a
 * track whose clip is that loop, placed at bar 1.
 *
 * This is the other half of {@link loadSampleCommands}, and the asset's `kind`
 * is what chooses between them. A one-shot loads onto a sampler the producer
 * has selected; a loop has no instrument to load onto — it *is* the material —
 * so it arrives as an audio track (`type: "audio"`, no instrument) carrying an
 * `audioLoop` clip. No existing track is touched either way.
 *
 * The new track deliberately gets **no empty note clip**. `createNewTrack`
 * mints one so a fresh instrument track is immediately programmable; an audio
 * track has nothing to program, and an empty note clip on it would be a second,
 * silent thing on the timeline that the producer did not ask for.
 *
 * `sourceTempo` is the loop's own tempo where it states one, and the song's
 * where it does not — which makes the stretch ratio exactly 1 and leaves the
 * audio untouched, rather than guessing a tempo and stretching to a fiction.
 */
export function insertLoopCommands(
  project: Project,
  sample: LibrarySample,
  context: DomainFactoryContext,
  options: InsertLoopOptions,
): readonly RawCommandInput[] {
  const existing = carriedAsset(project, sample);
  const asset = existing ?? createLibraryAsset(context, sample);

  const name = uniqueName(sample.name, options.existingNames);
  const track = createTrack(context, {
    name,
    order: options.order,
    type: "audio",
    instrument: null,
  });
  const lengthTicks = loopClipLengthTicks(sample);
  const clip = createAudioLoopClip(context, {
    trackId: track.id,
    name,
    assetId: asset.id,
    sourceTempo: sample.bpm ?? options.songTempo,
    lengthTicks,
  });
  const placement = createPlacement(context, {
    clipId: clip.id,
    trackId: track.id,
    startTicks: 0,
    durationTicks: lengthTicks,
  });

  // The track carries its clip and placement in the one command, so the whole
  // insertion is one revision and one undo — take it back and the track, the
  // clip and the asset go together, leaving nothing orphaned.
  const create = addTrack(track, { clips: [clip], placements: [placement] });
  return existing ? [create] : [addAsset(asset), create];
}

/** `Hat`, then `Hat 2`, `Hat 3`, ... — the rule `createNewTrack` uses. */
function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
