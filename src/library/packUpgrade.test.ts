import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands";
import { packVersion } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import { createDrumMachineFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { fixtureFetcher, fixturePackManifest } from "./__fixtures__/fixtures";
import { loadPadSampleCommands, toLibrarySample } from "./insertion";
import { LibraryClient } from "./libraryClient";
import { packAssets, parsePackManifest } from "./manifest";
import {
  checkPackUpgrade,
  packUpgradeFor,
  pinnedPackVersion,
  soundsMissingAfterUpgrade,
} from "./packUpgrade";

/** Is inserting a newer version's sound a safe upgrade of the pin? (#892) */

const OLD = packVersion("1.0.0");

function context(seed: string) {
  return createFactoryContext({
    ids: createSeededIdFactory(seed),
    now: 1_700_000_000_000,
  });
}

function drumSamples() {
  const assets = packAssets(
    parsePackManifest(fixturePackManifest("core-electronic-drums")),
  );
  const samples = assets.flatMap((asset) => {
    const sample = toLibrarySample(asset);
    return sample && sample.kind === "sample" ? [sample] : [];
  });
  if (samples.length < 2) throw new Error("expected two one-shots");
  return samples;
}

/**
 * A project with one pad playing a Core Electronic Drums sound pinned at
 * 1.0.0. `gone` swaps its content for a storage ref the newer manifest does
 * not deliver, as if the sound had been dropped from the pack.
 */
function pinnedProject(gone = false) {
  const [kept] = drumSamples();
  const older = {
    ...kept,
    packVersion: OLD,
    storageRef: gone
      ? "samples/starter-library/audio/sha256/00/00/gone.wav"
      : kept.storageRef,
  };
  const fixture = createDrumMachineFixtureProject();
  const track = fixture.song.tracks.find((t) => t.instrument?.kind === "drumMachine");
  if (track?.instrument?.kind !== "drumMachine") throw new Error("no drum machine");
  const seeded = executeTransaction(
    fixture,
    loadPadSampleCommands(
      fixture,
      track.id,
      track.instrument.pads[0].id,
      older,
      context("pin"),
    ),
  );
  if (!seeded.ok) throw new Error(seeded.issues[0].message);
  return seeded.project;
}

describe("packUpgradeFor", () => {
  it("names the move from the pinned version to the sound's", () => {
    const project = pinnedProject();
    const [, newer] = drumSamples();

    expect(pinnedPackVersion(project, newer.packId)).toBe(OLD);
    expect(packUpgradeFor(project, newer)).toEqual({
      packId: newer.packId,
      from: OLD,
      to: newer.packVersion,
    });
  });

  it("is null for a pack the project does not use, or already pins at that version", () => {
    const [, newer] = drumSamples();
    expect(packUpgradeFor(createDrumMachineFixtureProject(), newer)).toBeNull();
    expect(packUpgradeFor(pinnedProject(), { ...newer, packVersion: OLD })).toBeNull();
  });
});

describe("soundsMissingAfterUpgrade", () => {
  it("counts the project's sounds from the pack the newer version does not deliver", () => {
    const project = pinnedProject(true);
    const [, newer] = drumSamples();
    const upgrade = packUpgradeFor(project, newer);
    if (!upgrade) throw new Error("expected an upgrade");

    expect(soundsMissingAfterUpgrade(project, upgrade, new Set())).toBe(1);
    expect(
      soundsMissingAfterUpgrade(
        project,
        upgrade,
        new Set(project.song.assets.map((asset) => asset.storageRef)),
      ),
    ).toBe(0);
  });
});

describe("checkPackUpgrade", () => {
  it("is safe when every sound the project uses is in the newer manifest", async () => {
    const [, newer] = drumSamples();
    const check = await checkPackUpgrade(
      pinnedProject(),
      newer,
      new LibraryClient(fixtureFetcher()),
    );
    expect(check.kind).toBe("safe");
  });

  it("is unsafe, with the count, when one would go missing", async () => {
    const [, newer] = drumSamples();
    const check = await checkPackUpgrade(
      pinnedProject(true),
      newer,
      new LibraryClient(fixtureFetcher()),
    );
    expect(check).toMatchObject({ kind: "unsafe", missing: 1 });
  });

  it("is unsafe with an unknown count when the newer manifest cannot be read", async () => {
    const [, newer] = drumSamples();
    const failing = new LibraryClient(async () => {
      throw new Error("offline");
    });
    const check = await checkPackUpgrade(pinnedProject(), newer, failing);
    expect(check).toMatchObject({ kind: "unsafe", missing: null });
  });

  it("checks a version the caller holds itself without reading the index", async () => {
    const [, newer] = drumSamples();
    const project = pinnedProject(true);
    const offline = new LibraryClient(async () => {
      throw new Error("offline");
    });
    const everything = new Set(project.song.assets.map((asset) => asset.storageRef));
    const held = (packId: string, version: string) =>
      packId === newer.packId && version === newer.packVersion ? everything : null;
    expect((await checkPackUpgrade(project, newer, offline, held)).kind).toBe("safe");
    // Holding some other version is no help: the index decides, and is offline.
    expect(await checkPackUpgrade(project, newer, offline, () => null)).toMatchObject({
      kind: "unsafe",
      missing: null,
    });
  });

  it("needs no upgrade for a pack the project does not use yet", async () => {
    const [, newer] = drumSamples();
    const check = await checkPackUpgrade(
      createDrumMachineFixtureProject(),
      newer,
      new LibraryClient(fixtureFetcher()),
    );
    expect(check.kind).toBe("none");
  });
});
