import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands";
import { createFactoryContext } from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { fixturePackManifest } from "./__fixtures__/fixtures";
import {
  carriedAsset,
  createLibraryAsset,
  insertLoopCommands,
  loadSampleCommands,
  loopClipLengthTicks,
  toLibrarySample,
} from "./insertion";
import { LIBRARY_ROOT, packAssets, parsePackManifest } from "./manifest";

/**
 * Loading a browsed sound onto a track (#225).
 *
 * The assets here come from the committed slice of the real delivered library,
 * so this exercises the wire shape production parses rather than a hand-written
 * asset that could drift from it.
 */

async function libraryAssets(slug = "core-electronic-drums") {
  const raw = fixturePackManifest(slug);
  return packAssets(parsePackManifest(raw));
}

function context(seed = "insertion") {
  return createFactoryContext({
    ids: createSeededIdFactory(seed),
    now: 1_700_000_000_000,
  });
}

describe("toLibrarySample", () => {
  it("keeps the facts a project stores and drops the browsing facets", async () => {
    const asset = (await libraryAssets())[0];
    const sample = toLibrarySample(asset);

    expect(sample).not.toBeNull();
    expect(sample?.name).toBe(asset.name);
    expect(sample?.packId).toBe(asset.packId);
    expect(sample?.packVersion).toBe(asset.packVersion);
    expect(sample?.storageRef).toBe(`${LIBRARY_ROOT}/audio/${asset.storageKey}`);
    // The URL is whatever this page load resolves that delivery to — the
    // manifest's own, not a path this module reassembles. Under same-origin
    // delivery that is the storage reference with a leading slash; under
    // bucket delivery it is a Storage download URL, and the reference is
    // still the stable thing a project keeps.
    expect(sample?.url).toBe(asset.url);
    expect(sample).not.toHaveProperty("genres");
    expect(sample).not.toHaveProperty("role");
  });

  it("calls a tempo-labelled loop a loop, and a one-shot a sample", async () => {
    const assets = await libraryAssets("foundation-bass");
    const loop = assets.find((asset) => asset.type === "loop");
    const oneShot = assets.find((asset) => asset.type === "one-shot");
    if (!loop || !oneShot) throw new Error("expected a loop and a one-shot");
    expect(toLibrarySample(loop)?.kind).toBe("loop");
    expect(toLibrarySample(oneShot)?.kind).toBe("sample");
  });

  it("refuses an asset with no master audio, so nothing dangles", async () => {
    const assets = await libraryAssets();
    const withoutAudio = { ...assets[0], storageKey: null, url: null };
    expect(toLibrarySample(withoutAudio)).toBeNull();
  });

  it("refuses a manifest row whose pack id is not a pack id", async () => {
    const assets = await libraryAssets();
    expect(toLibrarySample({ ...assets[0], packId: "nope" })).toBeNull();
  });
});

describe("loadSampleCommands", () => {
  it("carries the sound and points the sampler at it, in one transaction", async () => {
    const project = createSliceFixtureProject();
    const track = project.song.tracks[0];
    const sample = toLibrarySample((await libraryAssets())[1]);
    if (!sample) throw new Error("expected an insertable sample");

    const result = executeTransaction(
      project,
      loadSampleCommands(project, track.id, sample, context()),
    );
    expect(result.ok, result.ok ? "" : result.issues[0].message).toBe(true);
    if (!result.ok) return;

    const asset = carriedAsset(result.project, sample);
    expect(asset?.name).toBe(sample.name);
    expect(asset?.provenance.licence).toBe(sample.licence);
    const instrument = result.project.song.tracks[0].instrument;
    expect(instrument?.kind === "sampler" && instrument.assetId).toBe(asset?.id);
    // One transaction: one revision, so one undo takes the whole drop back.
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
    expect(result.commands).toHaveLength(2);
  });

  it("reuses a delivery the project already carries rather than duplicating it", async () => {
    const project = createSliceFixtureProject();
    const track = project.song.tracks[0];
    const sample = toLibrarySample((await libraryAssets())[1]);
    if (!sample) throw new Error("expected an insertable sample");

    const first = executeTransaction(
      project,
      loadSampleCommands(project, track.id, sample, context("first")),
    );
    if (!first.ok) throw new Error(first.issues[0].message);
    const commands = loadSampleCommands(
      first.project,
      track.id,
      sample,
      context("second"),
    );
    expect(commands).toHaveLength(1);

    const second = executeTransaction(first.project, commands);
    if (!second.ok) throw new Error(second.issues[0].message);
    expect(second.project.song.assets).toHaveLength(first.project.song.assets.length);
  });

  it("changes nothing when the track's instrument is not a sampler", async () => {
    const project = createSliceFixtureProject();
    const sample = toLibrarySample((await libraryAssets())[0]);
    if (!sample) throw new Error("expected an insertable sample");
    // A track with no instrument at all: the asset must not be carried by a
    // transaction whose sample load is refused.
    const bare = { ...project.song.tracks[0], instrument: null };
    const withBare = {
      ...project,
      song: { ...project.song, tracks: [bare] },
    };

    const result = executeTransaction(
      withBare,
      loadSampleCommands(withBare, bare.id, sample, context()),
    );
    expect(result.ok).toBe(false);
    expect(result.project).toBe(withBare);
  });

  it("records the pack the sound resolved from as a dependency", async () => {
    const project = createSliceFixtureProject();
    const sample = toLibrarySample((await libraryAssets("tonal-elements"))[0]);
    if (!sample) throw new Error("expected an insertable sample");

    const result = executeTransaction(
      project,
      loadSampleCommands(project, project.song.tracks[0].id, sample, context()),
    );
    if (!result.ok) throw new Error(result.issues[0].message);
    expect(
      result.project.metadata.packDependencies.some(
        (dependency) =>
          dependency.packId === sample.packId &&
          dependency.version === sample.packVersion,
      ),
    ).toBe(true);
  });
});

describe("createLibraryAsset", () => {
  it("mints a project-scoped reference rather than reusing the library id", async () => {
    const asset = (await libraryAssets())[0];
    const sample = toLibrarySample(asset);
    if (!sample) throw new Error("expected an insertable sample");
    const created = createLibraryAsset(context(), sample);

    expect(created.id).toMatch(/^ast_/);
    expect(created.id).not.toBe(asset.id);
    expect(created.provenance.source).toBe("library");
  });
});

/**
 * Bringing a loop in as its own track (`LOOP-019`).
 *
 * These exist because the surface shipped without them: the arrangement's Loop
 * button opened the library, "Insert" reached a sampler-only path that returned
 * silently when no sampler was selected, and the window closed leaving the
 * project untouched — no track, no error, nothing in the console. Every
 * assertion below fails against that behaviour.
 */
describe("insertLoopCommands", () => {
  /** A loop with a stated tempo, from the delivered library. */
  async function loopSample() {
    const assets = await libraryAssets("core-electronic-drums");
    for (const asset of assets) {
      const sample = toLibrarySample(asset);
      if (sample?.kind === "loop" && sample.bpm) return sample;
    }
    // Not every committed fixture pack ships a tempo-labelled loop; build one
    // from a real asset rather than skipping, so the shape stays production's.
    const base = toLibrarySample(assets[0]);
    if (!base) throw new Error("expected an insertable asset");
    return { ...base, kind: "loop" as const, bpm: 140, durationSeconds: 3.4285 };
  }

  it("adds an audio track carrying the loop at bar 1, in one transaction", async () => {
    const project = createSliceFixtureProject();
    const sample = await loopSample();
    const before = project.song.tracks.length;

    const result = executeTransaction(
      project,
      insertLoopCommands(project, sample, context(), {
        order: before,
        existingNames: project.song.tracks.map((track) => track.name),
        songTempo: project.song.tempo,
      }),
    );
    expect(result.ok, result.ok ? "" : result.issues[0].message).toBe(true);
    if (!result.ok) return;

    // A new track, at the bottom, and no existing track touched.
    expect(result.project.song.tracks).toHaveLength(before + 1);
    const track = result.project.song.tracks[before];
    expect(track.name).toBe(sample.name);
    expect(track.order).toBe(before);
    expect(track.type).toBe("audio");
    expect(track.instrument).toBeNull();

    // Carrying the loop: the clip is the asset, at the loop's own tempo.
    const asset = carriedAsset(result.project, sample);
    expect(asset).not.toBeNull();
    const clip = result.project.clips.find((entry) => entry.trackId === track.id);
    expect(clip?.content.kind).toBe("audioLoop");
    if (clip?.content.kind !== "audioLoop") return;
    expect(clip.content.assetId).toBe(asset?.id);
    expect(clip.content.sourceTempo).toBe(sample.bpm ?? project.song.tempo);
    expect(clip.content.startOffsetTicks).toBe(0);

    // Placed at bar 1, spanning the clip.
    const placement = result.project.song.placements.find(
      (entry) => entry.trackId === track.id,
    );
    expect(placement?.startTicks).toBe(0);
    expect(placement?.durationTicks).toBe(clip.lengthTicks);
    expect(placement?.clipId).toBe(clip.id);

    // One transaction: one revision, so one undo takes the track, the clip and
    // the asset back together.
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
  });

  it("gives the new track no empty note clip", async () => {
    const project = createSliceFixtureProject();
    const sample = await loopSample();
    const result = executeTransaction(
      project,
      insertLoopCommands(project, sample, context(), {
        order: project.song.tracks.length,
        existingNames: [],
        songTempo: project.song.tempo,
      }),
    );
    if (!result.ok) throw new Error(result.issues[0].message);

    const track = result.project.song.tracks.at(-1);
    const clips = result.project.clips.filter((entry) => entry.trackId === track?.id);
    // Exactly one clip, and it is the loop — an audio track has nothing to
    // program, so the empty one-bar note clip a new instrument track gets
    // would be a second, silent thing on the timeline.
    expect(clips).toHaveLength(1);
    expect(clips[0].content.kind).toBe("audioLoop");
  });

  it("reuses a delivery the project already carries", async () => {
    const project = createSliceFixtureProject();
    const sample = await loopSample();
    const options = {
      order: project.song.tracks.length,
      existingNames: project.song.tracks.map((track) => track.name),
      songTempo: project.song.tempo,
    };
    const first = executeTransaction(
      project,
      insertLoopCommands(project, sample, context("first"), options),
    );
    if (!first.ok) throw new Error(first.issues[0].message);

    const commands = insertLoopCommands(first.project, sample, context("second"), {
      ...options,
      order: first.project.song.tracks.length,
      existingNames: first.project.song.tracks.map((track) => track.name),
    });
    // The track is added; the asset is not carried twice.
    expect(commands).toHaveLength(1);

    const second = executeTransaction(first.project, commands);
    if (!second.ok) throw new Error(second.issues[0].message);
    expect(second.project.song.assets).toHaveLength(first.project.song.assets.length);
    // ... and the second track's name does not collide with the first's.
    expect(second.project.song.tracks.at(-1)?.name).not.toBe(
      first.project.song.tracks.at(-1)?.name,
    );
  });

  it("sizes the clip in whole bars from the loop's own tempo", async () => {
    const base = await loopSample();
    // Two bars at 140 BPM: 8 beats / (140/60) = 3.4285s.
    expect(loopClipLengthTicks({ ...base, bpm: 140, durationSeconds: 3.4285 })).toBe(
      2 * TICKS_PER_BAR,
    );
    // One bar at 120: 4 beats = 2s.
    expect(loopClipLengthTicks({ ...base, bpm: 120, durationSeconds: 2 })).toBe(
      TICKS_PER_BAR,
    );
    // A loop that states no tempo is not guessed at — one bar, unstretched.
    expect(loopClipLengthTicks({ ...base, bpm: null, durationSeconds: 3.4285 })).toBe(
      TICKS_PER_BAR,
    );
    expect(loopClipLengthTicks({ ...base, bpm: 140, durationSeconds: null })).toBe(
      TICKS_PER_BAR,
    );
  });

  it("plays unstretched when the loop states no tempo", async () => {
    const project = createSliceFixtureProject();
    const base = await loopSample();
    const sample = { ...base, bpm: null };

    const result = executeTransaction(
      project,
      insertLoopCommands(project, sample, context(), {
        order: project.song.tracks.length,
        existingNames: [],
        songTempo: project.song.tempo,
      }),
    );
    if (!result.ok) throw new Error(result.issues[0].message);

    const clip = result.project.clips.at(-1);
    if (clip?.content.kind !== "audioLoop") throw new Error("expected an audio loop");
    // sourceTempo === song tempo makes the stretch ratio exactly 1, so the
    // audio is left alone rather than stretched to a tempo nobody stated.
    expect(clip.content.sourceTempo).toBe(project.song.tempo);
  });
});
