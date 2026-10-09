import { describe, expect, it } from "vitest";
import { validateRecommendation } from "../../assistant/recommendation";
import { CONTROL_PARTS, controlAddress } from "../../commands/controlAddress";
import type { Project, Track } from "../../domain/entities";
import {
  createDrumPad,
  createFactoryContext,
  createSynthInstrument,
  createTrack,
} from "../../domain/factories";
import { createSliceFixtureProject } from "../../domain/fixtures";
import type { PadId } from "../../domain/ids";
import { fixtureFetcher } from "../../library/__fixtures__/fixtures";
import { LibraryClient } from "../../library/libraryClient";
import { emptyPadSelection, withSelectedPad } from "../padSelection";
import { createStarterProject } from "../starterProject";
import { createAssistantLibrary, libraryContext } from "./assistantLibrary";
import {
  recommendationSlot,
  resolveRecommendation,
  slotExists,
  soundToTry,
} from "./recommendationCardModel";

const project = createStarterProject("uid-1");
const bd = project.song.tracks[0] as Track;
const kit = bd.instrument?.kind === "drumMachine" ? bd.instrument : null;
const kickPad = kit?.pads[0];
if (!kickPad) throw new Error("the starter has no BD pad");

/** The starter with a second pad, "SD", on BD. */
function withSnarePad(): { project: Project; snareId: PadId } {
  const snare = createDrumPad(createFactoryContext(), { name: "SD" });
  const tracks = project.song.tracks.map((track) =>
    track.id === bd.id && track.instrument?.kind === "drumMachine"
      ? {
          ...track,
          instrument: { ...track.instrument, pads: [...track.instrument.pads, snare] },
        }
      : track,
  );
  return {
    project: { ...project, song: { ...project.song, tracks } },
    snareId: snare.id,
  };
}

describe("recommendationSlot (GRV-23)", () => {
  it("tries on a drum machine's selected pad, named for the pad", () => {
    const slot = recommendationSlot(project, bd.id, null, emptyPadSelection);
    expect(slot).toEqual({
      target: { kind: "pad", trackId: bd.id, padId: kickPad.id },
      label: "BD",
      address: controlAddress(kickPad.id, CONTROL_PARTS.sample),
      preview: { trackId: bd.id, padId: kickPad.id },
    });
  });

  it("follows the pad the track has selected", () => {
    const { project: twoPads, snareId } = withSnarePad();
    const slot = recommendationSlot(
      twoPads,
      bd.id,
      null,
      withSelectedPad(emptyPadSelection, bd.id, snareId),
    );
    expect(slot?.label).toBe("SD");
    expect(slot?.preview).toEqual({ trackId: bd.id, padId: snareId });
  });

  it("tries on a sampler's sample, named for its track", () => {
    const slice = createSliceFixtureProject();
    const sampler = slice.song.tracks[0] as Track;
    const slot = recommendationSlot(slice, sampler.id, null, emptyPadSelection);
    expect(slot?.target).toEqual({ kind: "sampler", trackId: sampler.id });
    expect(slot?.address).toEqual(controlAddress(sampler.id, CONTROL_PARTS.sample));
    expect(slot?.label).toBe(sampler.name);
  });

  it("uses the selected track when the recommendation names none, or one the song lacks", () => {
    expect(recommendationSlot(project, null, bd, emptyPadSelection)?.label).toBe("BD");
    expect(recommendationSlot(project, "trk_gone", bd, emptyPadSelection)?.label).toBe(
      "BD",
    );
    expect(recommendationSlot(project, null, null, emptyPadSelection)).toBeNull();
  });

  it("has no slot on a synth", () => {
    const synth = createTrack(createFactoryContext(), {
      name: "Lead",
      order: 1,
      instrument: createSynthInstrument(),
    });
    const song = { ...project.song, tracks: [...project.song.tracks, synth] };
    expect(
      recommendationSlot({ ...project, song }, synth.id, null, emptyPadSelection),
    ).toBeNull();
  });

  it("knows when its slot has left the song", () => {
    const slot = recommendationSlot(project, bd.id, null, emptyPadSelection);
    if (!slot) throw new Error("no slot");
    expect(slotExists(project, slot)).toBe(true);
    const emptied = {
      ...project,
      song: { ...project.song, tracks: [] },
    };
    expect(slotExists(emptied, slot)).toBe(false);
  });
});

describe("resolveRecommendation", () => {
  it("reads a recommendation's pack and sounds back from the library", async () => {
    const catalog = await createAssistantLibrary(
      new LibraryClient(fixtureFetcher()),
    ).load();
    if (!catalog) throw new Error("no library");
    const context = libraryContext(catalog, project);
    const drums = context.packs.find((pack) => pack.name === "Core Electronic Drums");
    const validation = validateRecommendation(
      {
        packId: drums?.id,
        soundIds: ["sg-one-shot-drums-kick-0004", "sg-one-shot-drums-kick-0002"],
        reason: "Softer.",
      },
      context,
    );
    if (!validation.ok) throw new Error(validation.message);
    const resolved = resolveRecommendation(validation.recommendation, catalog);
    expect(resolved?.pack.slug).toBe("core-electronic-drums");
    expect(resolved?.sounds.map((sound) => sound.name)).toEqual([
      "Soft Rounded Kick",
      "Tight House Kick",
    ]);
    expect(resolved?.sounds[0]?.url).not.toBeNull();
    expect(resolved?.packSounds.length).toBeGreaterThan(2);
    expect(resolveRecommendation(validation.recommendation, { packs: [] })).toBeNull();
  });

  it("tries the first one-shot it suggests", async () => {
    const catalog = await createAssistantLibrary(
      new LibraryClient(fixtureFetcher()),
    ).load();
    const sounds = catalog?.packs.flatMap((entry) => entry.sounds) ?? [];
    const loop = sounds.find((sound) => sound.type === "loop");
    const shot = sounds.find((sound) => sound.type === "one-shot");
    if (!loop || !shot) throw new Error("the fixtures lack a loop or a one-shot");
    expect(soundToTry([loop, shot])).toBe(shot);
    expect(soundToTry([loop])).toBeNull();
  });
});
