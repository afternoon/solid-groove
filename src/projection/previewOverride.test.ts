import { describe, expect, it } from "vitest";
import { packVersion } from "../domain/entities";
import {
  createDrumMachineFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import type { PackId } from "../domain/ids";
import { buildAudioProjection } from "./audioProjection";
import {
  applyPreviewOverride,
  type PreviewSound,
  previewAssetId,
} from "./previewOverride";

function sound(name: string): PreviewSound {
  return {
    packId: "pak_previewpreviewpreview" as PackId,
    packVersion: packVersion("1.0.0"),
    kind: "sample",
    storageRef: `library/audio/${name}.wav`,
    url: `/library/audio/${name}.wav`,
    durationSeconds: 0.5,
    sampleRate: 48_000,
    channelCount: 1,
  };
}

describe("applyPreviewOverride", () => {
  it("swaps only the sampler's asset and adds the preview sound to the assets", () => {
    const project = createSliceFixtureProject();
    const base = buildAudioProjection(project);
    const track = base.tracks[0];
    const heard = sound("snare");

    const next = applyPreviewOverride(base, {
      slot: { trackId: track.id },
      sound: heard,
    });

    const swapped = next.tracksById.get(track.id);
    expect(swapped?.instrument).toMatchObject({
      kind: "sampler",
      assetId: previewAssetId(heard),
    });
    expect(swapped?.topologyFingerprint).not.toBe(track.topologyFingerprint);
    expect(next.assets.map((asset) => asset.id)).toContain(previewAssetId(heard));
    expect(next.assets).toHaveLength(base.assets.length + 1);
    expect(applyPreviewOverride(base, null)).toBe(base);
    expect(track.instrument).toMatchObject({ assetId: project.song.assets[0].id });
    expect(base.assets.map((asset) => asset.id)).not.toContain(previewAssetId(heard));
  });

  it("swaps exactly one pad and shares every other track and pad", () => {
    const base = buildAudioProjection(createDrumMachineFixtureProject());
    const drums = base.tracks.find((track) => track.instrument?.kind === "drumMachine");
    if (drums?.instrument?.kind !== "drumMachine") throw new Error("no drum track");
    const [kick, clap] = drums.instrument.pads;

    const next = applyPreviewOverride(base, {
      slot: { trackId: drums.id, padId: kick.id },
      sound: sound("kick"),
    });

    const swapped = next.tracksById.get(drums.id)?.instrument;
    if (swapped?.kind !== "drumMachine") throw new Error("no drum track");
    expect(swapped.pads[0].assetId).toBe(previewAssetId(sound("kick")));
    expect(swapped.pads[1]).toBe(clap);
    for (const track of base.tracks) {
      if (track.id !== drums.id) expect(next.tracksById.get(track.id)).toBe(track);
    }
  });

  it("leaves the projection alone for a slot that does not exist or does not match", () => {
    const base = buildAudioProjection(createDrumMachineFixtureProject());
    const drums = base.tracks.find((track) => track.instrument?.kind === "drumMachine");
    const audio = base.tracks.find((track) => track.type === "audio");
    if (!drums || !audio) throw new Error("fixture changed");

    const slots = [
      { trackId: "trk_gone" as never },
      { trackId: drums.id, padId: "pad_gone" as never },
      { trackId: audio.id },
      { trackId: drums.id },
    ];
    for (const slot of slots) {
      expect(applyPreviewOverride(base, { slot, sound: sound("x") })).toBe(base);
    }
  });
});
