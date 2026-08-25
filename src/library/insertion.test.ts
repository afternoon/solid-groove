import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands";
import { createFactoryContext } from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import {
  carriedAsset,
  createLibraryAsset,
  loadSampleCommands,
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
  const raw = await fixtureFetcher()(`samples/starter-library/packs/${slug}/x.json`);
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
