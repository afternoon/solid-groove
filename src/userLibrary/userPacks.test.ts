import { describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import {
  availablePacksFor,
  createDrumMachineFixtureProject,
  drumMachineFixturePacks,
} from "../domain/fixtures";
import type { PackId } from "../domain/ids";
import { resolvePackAvailability } from "../domain/packs";
import { toLibrarySample } from "../library/insertion";
import {
  addSound,
  cleanPackName,
  DEFAULT_PACK_NAME,
  type NewUserPackAsset,
  newUserPack,
  parseUserPack,
  removeSound,
  renamePack,
  renameSound,
  type UserPack,
  userPackAssets,
  userPackAvailability,
  userPackHoldings,
  userPackSummary,
} from "./userPacks";

const PACK_ID = "pak_userpackuserpackuser1" as PackId;

function sound(id: string, name = "tape kick"): NewUserPackAsset {
  return {
    id: id as NewUserPackAsset["id"],
    name,
    type: "one-shot",
    family: "drums",
    role: "kick",
    storagePath: `users/u1/packs/${PACK_ID}/${id}`,
    contentType: "audio/wav",
    sizeBytes: 8_864,
    durationSeconds: 0.1,
    sampleRate: 44_100,
    channelCount: 1,
    bpm: null,
    peaks: null,
    createdAt: 5,
  };
}

const KICK = "ast_kickkickkickkickkick1";
const SNARE = "ast_snaresnaresnaresnare1";

describe("a personal pack", () => {
  it("starts empty at 1.0.0 with the name it was given", () => {
    const pack = newUserPack(PACK_ID, "  Field   Recordings ", 1);
    expect(pack).toMatchObject({
      id: PACK_ID,
      kind: "user",
      name: "Field Recordings",
      version: "1.0.0",
      assets: [],
    });
    expect(parseUserPack(pack)).toEqual(pack);
  });

  it("falls back to a default name when given none", () => {
    expect(newUserPack(PACK_ID, "   ", 1).name).toBe(DEFAULT_PACK_NAME);
    expect(cleanPackName("")).toBeNull();
    expect(cleanPackName("x".repeat(200))).toHaveLength(80);
  });

  it("moves to a new minor version for each sound added", () => {
    const one = addSound(newUserPack(PACK_ID, "P", 1), sound(KICK), 2);
    const two = addSound(one, sound(SNARE, "snare"), 3);
    expect(one.version).toBe("1.1.0");
    expect(two.version).toBe("1.2.0");
    expect(two.assets.map((asset) => asset.addedInVersion)).toEqual(["1.1.0", "1.2.0"]);
    expect(two.modifiedAt).toBe(3);
  });

  it("moves to a new major version when a sound is deleted", () => {
    const pack = addSound(
      addSound(newUserPack(PACK_ID, "P", 1), sound(KICK), 2),
      sound(SNARE),
      3,
    );
    const after = removeSound(pack, KICK, 4);
    expect(after.version).toBe("2.0.0");
    expect(after.assets.map((asset) => asset.id)).toEqual([SNARE]);
    expect(removeSound(after, KICK, 5)).toBe(after);
  });

  it("keeps its version when renamed", () => {
    const pack = addSound(newUserPack(PACK_ID, "P", 1), sound(KICK), 2);
    const renamed = renamePack(pack, "Drums", 3);
    expect(renamed).toMatchObject({ name: "Drums", version: "1.1.0", modifiedAt: 3 });
    expect(renamePack(renamed, "  ", 4)).toBe(renamed);
  });

  it("keeps its version when one of its sounds is renamed", () => {
    const pack = addSound(
      addSound(newUserPack(PACK_ID, "P", 1), sound(KICK), 2),
      sound(SNARE, "snare"),
      3,
    );
    const renamed = renameSound(pack, KICK, "  Tape   Kick 2 ", 4);
    expect(renamed).toMatchObject({ version: "1.2.0", modifiedAt: 4 });
    expect(renamed.assets.map((asset) => asset.name)).toEqual(["Tape Kick 2", "snare"]);
    expect(renamed.assets[0]).toEqual({ ...pack.assets[0], name: "Tape Kick 2" });
    expect(renameSound(renamed, KICK, "   ", 5)).toBe(renamed);
    expect(renameSound(renamed, KICK, "Tape Kick 2", 5)).toBe(renamed);
    expect(renameSound(renamed, "ast_gonegonegonegonegone1", "x", 5)).toBe(renamed);
    expect(renameSound(renamed, SNARE, "y".repeat(200), 5).assets[1].name).toHaveLength(
      120,
    );
  });

  it("rejects a stored document that is not a pack", () => {
    expect(
      parseUserPack({ ...newUserPack(PACK_ID, "P", 1), kind: "factory" }),
    ).toBeNull();
    expect(parseUserPack(null)).toBeNull();
  });
});

describe("a personal pack in the library", () => {
  const pack = addSound(newUserPack(PACK_ID, "Field Recordings", 1), sound(KICK), 2);

  it("lists as a user pack, never by a published slug", () => {
    expect(userPackSummary(pack)).toMatchObject({
      id: PACK_ID,
      kind: "user",
      name: "Field Recordings",
      version: "1.1.0",
      assetCount: 1,
    });
  });

  it("offers its sounds as ordinary, pack-qualified library assets", () => {
    const [asset] = userPackAssets(pack);
    expect(asset).toMatchObject({
      id: KICK,
      name: "tape kick",
      type: "one-shot",
      family: "drums",
      role: "kick",
      packId: PACK_ID,
      packName: "Field Recordings",
      packVersion: "1.1.0",
      url: null,
      storageRef: `users/u1/packs/${PACK_ID}/${KICK}`,
      durationSeconds: 0.1,
      sampleRate: 44_100,
    });
  });

  it("inserts from where its audio is stored, not from the factory library", () => {
    const sample = toLibrarySample(userPackAssets(pack)[0]);
    expect(sample).toMatchObject({
      storageRef: `users/u1/packs/${PACK_ID}/${KICK}`,
      // No URL travels into the project: one would let anyone who can read
      // the project fetch the owner's audio.
      url: null,
      packId: PACK_ID,
      packVersion: "1.1.0",
    });
  });
});

describe("resolving a project against a personal pack", () => {
  // The fixture's drum pack stands in for a personal pack. Its sounds are
  // stored under the owner, as an inserted personal sound's are, and the
  // project knows them by IDs of its own: the pack matches them by path.
  const fixture = createDrumMachineFixtureProject();
  const packs = drumMachineFixturePacks();
  const loops = availablePacksFor(fixture, [packs.loops]);
  const storedAt = (assetId: string) => `users/u1/packs/${packs.drums.id}/${assetId}`;
  const project: Project = {
    ...fixture,
    song: {
      ...fixture.song,
      assets: fixture.song.assets.map((asset) =>
        asset.packId === packs.drums.id
          ? { ...asset, storageRef: storedAt(asset.id) }
          : asset,
      ),
    },
  };
  const drumAssets = project.song.assets.filter(
    (asset) => asset.packId === packs.drums.id,
  );

  function personalDrums(): UserPack {
    let pack: UserPack = { ...newUserPack(packs.drums.id, "Drums", 1) };
    drumAssets.forEach((asset, index) => {
      pack = addSound(
        pack,
        {
          ...sound(`ast_packsound${String(index).padStart(12, "0")}`, asset.name),
          storagePath: asset.storageRef,
        },
        2,
      );
    });
    return pack;
  }

  it("still resolves a project pinned to an earlier version after a sound is added", () => {
    const later = addSound(personalDrums(), sound("ast_newsoundnewsoundnews1"), 3);
    expect(later.version).not.toBe(packs.drums.version);
    const report = resolvePackAvailability(project, [
      ...loops,
      userPackHoldings(later, project),
    ]);
    expect(report).toEqual({ satisfied: true, missing: [], missingAssets: [] });
    expect(userPackAvailability(project, [later], "u1")).toEqual({
      missingAssets: [],
      missingPacks: [],
    });
  });

  it("reports a deleted sound as missing, naming its tracks and clips", () => {
    const clap = drumAssets.find((asset) => asset.name === "909 Clap");
    if (!clap) throw new Error("fixture has no clap");
    const before = personalDrums();
    const packClap = before.assets.find((asset) => asset.storagePath === clap.storageRef);
    if (!packClap) throw new Error("pack has no clap");
    const after = removeSound(before, packClap.id, 3);
    const report = userPackAvailability(project, [after], "u1");
    expect(report.missingPacks).toEqual([]);
    expect(report.missingAssets).toHaveLength(1);
    expect(report.missingAssets[0]).toMatchObject({ name: "909 Clap" });
    expect(report.missingAssets[0].tracks.map((track) => track.name)).toEqual(["Drums"]);
    expect(report.missingAssets[0].clips.map((clip) => clip.name)).toEqual(["Beat"]);
  });

  it("reports a deleted pack's sounds, and never judges the factory packs", () => {
    const report = userPackAvailability(project, [], "u1");
    expect(report.missingAssets).toEqual([]);
    expect(report.missingPacks.map((entry) => entry.packId)).toEqual([packs.drums.id]);
  });

  it("leaves a collaborator's personal sounds to them", () => {
    expect(userPackAvailability(project, [], "u2")).toEqual({
      missingAssets: [],
      missingPacks: [],
    });
  });

  it("has nothing to say about a project with no personal sounds", () => {
    expect(userPackAvailability(fixture, [], "u1")).toEqual({
      missingAssets: [],
      missingPacks: [],
    });
  });
});
