import { describe, expect, it } from "vitest";
import type { Pack } from "./entities";
import { packSchema, packVersion, packVersionSchema } from "./entities";
import {
  createAsset,
  createFactoryContext,
  createPack,
  FACTORY_PACK_RIGHTS,
  INITIAL_PACK_VERSION,
  packDependencyOf,
} from "./factories";
import {
  availablePacksFor,
  createDrumMachineFixtureProject,
  createSliceFixtureProject,
  drumMachineFixturePacks,
  sliceFixturePacks,
} from "./fixtures";
import { createSeededIdFactory, idPattern } from "./ids";
import type { AvailablePack } from "./packs";
import {
  derivePackDependencies,
  packDependenciesEqual,
  resolvePackAvailability,
  withDerivedPackDependencies,
} from "./packs";
import { isProject } from "./parse";
import { serializeProject } from "./serialize";

/**
 * The pack model (PRD LIB-05, section 9.4, invariant 12).
 *
 * The two-pack drum-machine fixture carries most of the weight here: a
 * single-pack project satisfies almost every assertion below even if pack
 * qualification is ignored entirely.
 */

function context(seed = "packs-test") {
  return createFactoryContext({
    ids: createSeededIdFactory(seed),
    now: 1_700_000_000_000,
  });
}

describe("the Pack entity", () => {
  it("carries every PRD section 9.4 field with a pak_ prefixed id", () => {
    const pack = createPack(context(), {
      name: "Techno Drums",
      version: "2.0.1",
      publisher: "Solid Groove",
      kind: "third-party",
      description: "Hard techno percussion.",
    });

    expect(pack.id).toMatch(idPattern("pack"));
    expect(pack).toEqual({
      id: pack.id,
      name: "Techno Drums",
      version: "2.0.1",
      publisher: "Solid Groove",
      kind: "third-party",
      description: "Hard techno percussion.",
      rights: FACTORY_PACK_RIGHTS,
    });
    expect(packSchema.safeParse(pack).success).toBe(true);
  });

  it("defaults to a bundled factory pack at its first version", () => {
    const pack = createPack(context(), { name: "House Drums" });

    expect(pack.kind).toBe("factory");
    expect(pack.version).toBe(INITIAL_PACK_VERSION);
    expect(pack.rights.rawRedistribution).toBe(true);
  });

  it("produces pack ids from the shared factory and its seeded variant", () => {
    const seeded = createSeededIdFactory("pack-seed");
    const replay = createSeededIdFactory("pack-seed");

    expect(seeded("pack")).toMatch(idPattern("pack"));
    expect(createSeededIdFactory("pack-seed")("pack")).toBe(replay("pack"));
  });

  it("accepts only major.minor.patch versions", () => {
    expect(packVersionSchema.safeParse("1.0.0").success).toBe(true);
    expect(packVersionSchema.safeParse("10.24.318").success).toBe(true);
    for (const bad of ["1.0", "v1.0.0", "1.0.0-beta", "latest", ""]) {
      expect(packVersionSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(() => packVersion("1")).toThrow();
  });

  it("rejects a pack whose kind is not one of the three", () => {
    const pack = createPack(context(), { name: "House Drums" });
    expect(packSchema.safeParse({ ...pack, kind: "marketplace" }).success).toBe(false);
  });
});

describe("pack-qualified assets", () => {
  it("stamps the pack and the version the asset resolved from", () => {
    const factory = context();
    const pack = createPack(factory, { name: "House Drums", version: "1.4.0" });
    const asset = createAsset(factory, {
      pack,
      name: "909 Bass Drum",
      storageRef: "samples/house/drums/bd/909-bd.wav",
    });

    expect(asset.packId).toBe(pack.id);
    expect(asset.packVersion).toBe("1.4.0");
    expect(packDependencyOf(pack)).toEqual({
      packId: pack.id,
      version: "1.4.0",
    });
  });

  it("lets two packs hold same-named assets without collision", () => {
    const factory = context();
    const first = createPack(factory, { name: "House Drums" });
    const second = createPack(factory, { name: "Techno Drums" });
    const options = { name: "Kick", storageRef: "samples/kick.wav" };

    const fromFirst = createAsset(factory, { ...options, pack: first });
    const fromSecond = createAsset(factory, { ...options, pack: second });

    expect(fromFirst.name).toBe(fromSecond.name);
    expect(fromFirst.id).not.toBe(fromSecond.id);
    expect(fromFirst.packId).not.toBe(fromSecond.packId);
  });
});

describe("derivePackDependencies", () => {
  it("returns one entry per pack the song's assets resolve from", () => {
    const project = createDrumMachineFixtureProject();
    const packs = drumMachineFixturePacks();

    expect(derivePackDependencies(project.song)).toEqual([
      ...[
        { packId: packs.drums.id, version: packs.drums.version },
        { packId: packs.loops.id, version: packs.loops.version },
      ].sort((a, b) => (a.packId < b.packId ? -1 : 1)),
    ]);
  });

  it("deduplicates the two drum assets that share one pack", () => {
    const project = createDrumMachineFixtureProject();

    expect(project.song.assets).toHaveLength(3);
    expect(derivePackDependencies(project.song)).toHaveLength(2);
  });

  it("is empty for a song with no assets", () => {
    const project = createDrumMachineFixtureProject();
    expect(derivePackDependencies({ ...project.song, assets: [] })).toEqual([]);
  });

  it("is deterministic regardless of asset order", () => {
    const project = createDrumMachineFixtureProject();
    const reversed = {
      ...project.song,
      assets: [...project.song.assets].reverse(),
    };

    expect(derivePackDependencies(reversed)).toEqual(
      derivePackDependencies(project.song),
    );
  });

  it("compares dependency lists by content, not order", () => {
    const derived = derivePackDependencies(createDrumMachineFixtureProject().song);

    expect(packDependenciesEqual(derived, [...derived].reverse())).toBe(true);
    expect(packDependenciesEqual(derived, derived.slice(1))).toBe(false);
  });
});

describe("withDerivedPackDependencies", () => {
  it("returns the identical project object when the list is already correct", () => {
    const project = createDrumMachineFixtureProject();
    expect(withDerivedPackDependencies(project)).toBe(project);
  });

  it("derives a list no valid project may hold, rather than papering over it", () => {
    // Two assets from the same pack at different versions is not something the
    // derivation can resolve — it reports the truth and `parseProject` refuses
    // the project, instead of silently picking a version.
    const project = createSliceFixtureProject();
    const factory = context("repacked");
    const [existing] = project.song.assets;
    const repacked = createAsset(factory, {
      pack: {
        ...sliceFixturePacks().drums,
        version: packVersion("9.9.9"),
      },
      name: "Repacked one-shot",
      storageRef: "samples/repacked/one-shot.wav",
    });
    const mixed = {
      ...project,
      song: { ...project.song, assets: [existing, repacked] },
    };

    const derived = derivePackDependencies(mixed.song);
    expect(derived).toHaveLength(2);
    expect(isProject(withDerivedPackDependencies(mixed))).toBe(false);
  });

  it("repairs a stale list without touching song or clips", () => {
    const project = createDrumMachineFixtureProject();
    const stale = {
      ...project,
      metadata: { ...project.metadata, packDependencies: [] },
    };

    const repaired = withDerivedPackDependencies(stale);

    expect(repaired.metadata.packDependencies).toEqual(project.metadata.packDependencies);
    expect(repaired.song).toBe(stale.song);
    expect(repaired.clips).toBe(stale.clips);
    expect(isProject(repaired)).toBe(true);
  });
});

describe("resolvePackAvailability", () => {
  const project = createDrumMachineFixtureProject();
  const packs = drumMachineFixturePacks();
  const allPacks = availablePacksFor(project, [packs.drums, packs.loops]);

  /** The library above with `pack` republished at `version`, contents unchanged. */
  function republished(pack: Pack, version: string): AvailablePack[] {
    return allPacks.map((entry) =>
      entry.pack.id === pack.id
        ? { ...entry, pack: { ...entry.pack, version: packVersion(version) } }
        : entry,
    );
  }

  /** The library above with `name` deleted from the pack that held it. */
  function withoutAsset(available: readonly AvailablePack[], name: string) {
    const asset = project.song.assets.find((candidate) => candidate.name === name);
    if (!asset) {
      throw new Error(`No fixture asset named ${name}`);
    }
    return available.map((entry) => ({
      ...entry,
      assetIds: entry.assetIds.filter((assetId) => assetId !== asset.id),
    }));
  }

  it("is satisfied when every pack still holds the assets the project uses", () => {
    expect(resolvePackAvailability(project, allPacks)).toEqual({
      satisfied: true,
      missing: [],
      missingAssets: [],
    });
  });

  it("names the tracks and clips a missing pack affects", () => {
    const report = resolvePackAvailability(
      project,
      allPacks.filter((entry) => entry.pack.id !== packs.drums.id),
    );

    expect(report.satisfied).toBe(false);
    expect(report.missingAssets).toEqual([]);
    expect(report.missing).toHaveLength(1);
    const [missing] = report.missing;
    expect(missing.packId).toBe(packs.drums.id);
    expect(missing.version).toBe(packs.drums.version);
    expect(missing.reason).toBe("pack_unavailable");
    expect(missing.assets.map((asset) => asset.name)).toEqual([
      "909 Bass Drum",
      "909 Clap",
    ]);
    expect(missing.tracks.map((track) => track.name)).toEqual(["Drums"]);
    expect(missing.clips.map((clip) => clip.name)).toEqual(["Beat"]);
  });

  it("scopes the report to the missing pack, not every track in the project", () => {
    const report = resolvePackAvailability(
      project,
      allPacks.filter((entry) => entry.pack.id !== packs.loops.id),
    );

    expect(report.missing).toHaveLength(1);
    const [missing] = report.missing;
    expect(missing.packId).toBe(packs.loops.id);
    expect(missing.tracks).toEqual([]);
    // The loop's clip is affected through its own audioLoop content, and the
    // drum track and its clip are not named at all.
    expect(missing.clips.map((clip) => clip.name)).toEqual(["Break loop"]);
  });

  it("resolves a later pack version that still holds every referenced asset", () => {
    // The personal-pack case: someone dropped one more sound into the pack, so
    // it republished at a version this project never pinned. Nothing is missing.
    const report = resolvePackAvailability(project, [
      ...republished(packs.drums, "9.0.0").filter(
        (entry) => entry.pack.id === packs.drums.id,
      ),
      ...allPacks.filter((entry) => entry.pack.id !== packs.drums.id),
    ]);

    expect(report).toEqual({ satisfied: true, missing: [], missingAssets: [] });
  });

  it("reports an asset deleted from the pack, with the tracks and clips using it", () => {
    const report = resolvePackAvailability(
      project,
      withoutAsset(republished(packs.drums, "9.0.0"), "909 Clap"),
    );

    expect(report.satisfied).toBe(false);
    // The pack itself is here, so this is not a missing pack.
    expect(report.missing).toEqual([]);
    expect(report.missingAssets).toHaveLength(1);
    const [missing] = report.missingAssets;
    expect(missing.name).toBe("909 Clap");
    expect(missing.packId).toBe(packs.drums.id);
    // The version the project pinned, not the version that exists.
    expect(missing.version).toBe(packs.drums.version);
    expect(missing.availableVersions).toEqual(["9.0.0"]);
    expect(missing.tracks.map((track) => track.name)).toEqual(["Drums"]);
    expect(missing.clips.map((clip) => clip.name)).toEqual(["Beat"]);
  });

  it("leaves the unaffected pack, track and clip out of a missing-asset report", () => {
    const report = resolvePackAvailability(project, withoutAsset(allPacks, "Break loop"));

    expect(report.missing).toEqual([]);
    expect(report.missingAssets).toHaveLength(1);
    const [missing] = report.missingAssets;
    expect(missing.name).toBe("Break loop");
    // An audio track has no instrument, so only the clip that plays the loop is
    // affected — the drum track and its clip are untouched.
    expect(missing.tracks).toEqual([]);
    expect(missing.clips.map((clip) => clip.name)).toEqual(["Break loop"]);
  });

  it("does not upgrade or rewrite the project when a later version resolves it", () => {
    // A later version may have re-labelled a sound (loop to one-shot, say) or
    // renamed it. None of that reaches this function — it is handed asset IDs,
    // not asset records — and resolving against that version changes nothing
    // the project stores: it still pins the version it was built with.
    const before = JSON.stringify(serializeProject(project));

    const report = resolvePackAvailability(project, republished(packs.drums, "9.0.0"));

    expect(report.satisfied).toBe(true);
    expect(JSON.stringify(serializeProject(project))).toBe(before);
    expect(project.metadata.packDependencies).toContainEqual({
      packId: packs.drums.id,
      version: packs.drums.version,
    });
    expect(isProject(project)).toBe(true);
  });

  it("reports every missing pack at once rather than the first", () => {
    const report = resolvePackAvailability(project, []);

    expect(report.missing.map((entry) => entry.packId).sort()).toEqual(
      [packs.drums.id, packs.loops.id].sort(),
    );
  });

  it("reports rather than throwing, and leaves the project valid", () => {
    expect(() => resolvePackAvailability(project, [])).not.toThrow();
    expect(isProject(project)).toBe(true);
  });

  it("ignores packs the caller holds that the project does not need", () => {
    const spare: AvailablePack = {
      pack: createPack(context("spare"), { name: "Unused Pack" }),
      assetIds: [],
    };

    expect(resolvePackAvailability(project, [...allPacks, spare]).satisfied).toBe(true);
  });

  it("covers the single-pack slice fixture too", () => {
    const slice = createSliceFixtureProject();
    const slicePacks = sliceFixturePacks();
    const available = availablePacksFor(slice, [slicePacks.drums]);

    expect(resolvePackAvailability(slice, available).satisfied).toBe(true);
    const report = resolvePackAvailability(slice, []);
    expect(report.missing[0].tracks.map((track) => track.name)).toEqual(["BD"]);
    expect(report.missing[0].clips.map((clip) => clip.name)).toEqual([
      "Four on the floor",
    ]);

    const deleted = resolvePackAvailability(slice, [{ ...available[0], assetIds: [] }]);
    expect(deleted.missing).toEqual([]);
    expect(deleted.missingAssets[0].tracks.map((track) => track.name)).toEqual(["BD"]);
    expect(deleted.missingAssets[0].clips.map((clip) => clip.name)).toEqual([
      "Four on the floor",
    ]);
  });
});
