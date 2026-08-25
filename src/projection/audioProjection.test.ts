import { describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import { createFactoryContext, createReturnBus } from "../domain/factories";
import {
  createDrumMachineFixtureProject,
  createReferenceProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { buildAudioProjection } from "./audioProjection";

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** A project with one return bus, so return-bus projection has something to test. */
function withReturnBus(project: Project, seed: string): Project {
  const context = createFactoryContext({ ids: createSeededIdFactory(seed) });
  const bus = createReturnBus(context, { name: "Reverb", order: 0 });
  return { ...project, song: { ...project.song, returns: [bus] } };
}

describe("buildAudioProjection", () => {
  it("projects tempo, tracks, clips, and placements from the slice fixture", () => {
    const project = createSliceFixtureProject();
    const projection = buildAudioProjection(project);

    expect(projection.revision).toBe(project.metadata.revision);
    expect(projection.tempo).toBe(project.song.tempo);
    expect(projection.tracks).toHaveLength(1);
    expect(projection.tracks[0].id).toBe(project.song.tracks[0].id);
    expect(projection.tracksById.get(project.song.tracks[0].id)).toBe(
      projection.tracks[0],
    );
    expect(projection.clips).toHaveLength(1);
    expect(projection.placements).toHaveLength(1);
  });

  it("never carries a track name or color", () => {
    const project = createSliceFixtureProject();
    const projection = buildAudioProjection(project);
    expect(projection.tracks[0]).not.toHaveProperty("name");
    expect(projection.tracks[0]).not.toHaveProperty("color");
  });

  it("projects return buses with a fingerprint and no name, alongside the master bus", () => {
    const project = withReturnBus(
      createSliceFixtureProject(),
      "audio-projection-returns",
    );
    const projection = buildAudioProjection(project);

    expect(projection.returns).toHaveLength(1);
    const returnBus = projection.returns[0];
    expect(returnBus.id).toBe(project.song.returns[0].id);
    expect(returnBus).not.toHaveProperty("name");
    expect(typeof returnBus.fingerprint).toBe("string");
    expect(typeof returnBus.topologyFingerprint).toBe("string");
    expect(projection.returnsById.get(returnBus.id)).toBe(returnBus);

    expect(typeof projection.master.fingerprint).toBe("string");
    expect(typeof projection.master.topologyFingerprint).toBe("string");
  });

  it("does not mutate the source project", () => {
    const project = createSliceFixtureProject();
    const before = JSON.parse(JSON.stringify(project));
    buildAudioProjection(project);
    expect(JSON.parse(JSON.stringify(project))).toEqual(before);
  });

  describe("renaming does not appear as an audio change", () => {
    it("keeps the same fingerprint and topologyFingerprint after a track rename", () => {
      const project = createSliceFixtureProject();
      const before = buildAudioProjection(project);

      const renamed: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: project.song.tracks.map((track) => ({
            ...track,
            name: "Renamed track",
          })),
        },
      };
      const after = buildAudioProjection(renamed, before);

      expect(after.tracks[0].fingerprint).toBe(before.tracks[0].fingerprint);
      expect(after.tracks[0].topologyFingerprint).toBe(
        before.tracks[0].topologyFingerprint,
      );
      // Nothing audio-relevant changed, so the previous object is reused.
      expect(after.tracks[0]).toBe(before.tracks[0]);
    });

    it("keeps the same fingerprint after a clip rename", () => {
      const project = createSliceFixtureProject();
      const before = buildAudioProjection(project);

      const renamed: Project = {
        ...project,
        clips: project.clips.map((clip) => ({ ...clip, name: "Renamed clip" })),
      };
      const after = buildAudioProjection(renamed, before);

      expect(after.clips[0]).toBe(before.clips[0]);
    });

    it("keeps the same fingerprint, topologyFingerprint, and reference after a return bus rename", () => {
      const project = withReturnBus(
        createSliceFixtureProject(),
        "audio-projection-return-rename",
      );
      const before = buildAudioProjection(project);

      const renamed: Project = {
        ...project,
        song: {
          ...project.song,
          returns: project.song.returns.map((bus) => ({
            ...bus,
            name: "Room",
          })),
        },
      };
      const after = buildAudioProjection(renamed, before);

      expect(after.returns[0].fingerprint).toBe(before.returns[0].fingerprint);
      expect(after.returns[0].topologyFingerprint).toBe(
        before.returns[0].topologyFingerprint,
      );
      // Nothing audio-relevant changed, so the previous object is reused.
      expect(after.returns[0]).toBe(before.returns[0]);
    });
  });

  describe("topology vs. parameter changes", () => {
    it("changes fingerprint but not topologyFingerprint for a mixer volume edit", () => {
      const project = createSliceFixtureProject();
      const before = buildAudioProjection(project);

      const edited: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: project.song.tracks.map((track) => ({
            ...track,
            mixer: { ...track.mixer, volume: -12 },
          })),
        },
      };
      const after = buildAudioProjection(edited, before);

      expect(after.tracks[0].topologyFingerprint).toBe(
        before.tracks[0].topologyFingerprint,
      );
      expect(after.tracks[0].fingerprint).not.toBe(before.tracks[0].fingerprint);
      expect(after.tracks[0]).not.toBe(before.tracks[0]);
    });

    it("changes topologyFingerprint when a device is added to the chain", () => {
      const project = createSliceFixtureProject();
      const before = buildAudioProjection(project);

      const deviceId = createSeededIdFactory("audio-projection-device")("device");
      const edited: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: project.song.tracks.map((track) => ({
            ...track,
            devices: [
              {
                id: deviceId,
                type: "filter",
                order: 0,
                bypassed: false,
                parameters: {},
                preset: null,
              },
            ],
          })),
        },
      };
      const after = buildAudioProjection(edited, before);

      expect(after.tracks[0].topologyFingerprint).not.toBe(
        before.tracks[0].topologyFingerprint,
      );
    });

    it("changes topologyFingerprint when a sampler's asset is swapped", () => {
      const drumMachineProject = createDrumMachineFixtureProject();
      const before = buildAudioProjection(drumMachineProject);
      const samplerTrack = requireDefined(
        drumMachineProject.song.tracks.find(
          (track) => track.instrument?.kind === "drumMachine",
        ),
        "expected the drum-machine fixture to have a drumMachine track",
      );

      const edited: Project = {
        ...drumMachineProject,
        song: {
          ...drumMachineProject.song,
          tracks: drumMachineProject.song.tracks.map((track) =>
            track.id === samplerTrack.id && track.instrument?.kind === "drumMachine"
              ? {
                  ...track,
                  instrument: {
                    ...track.instrument,
                    pads: track.instrument.pads.map((pad, index) =>
                      index === 0
                        ? {
                            ...pad,
                            assetId: drumMachineProject.song.assets[1].id,
                          }
                        : pad,
                    ),
                  },
                }
              : track,
          ),
        },
      };

      const after = buildAudioProjection(edited, before);
      const beforeTrack = requireDefined(
        before.tracksById.get(samplerTrack.id),
        "expected the sampler track to be projected",
      );
      const afterTrack = requireDefined(
        after.tracksById.get(samplerTrack.id),
        "expected the sampler track to be projected",
      );
      expect(afterTrack.topologyFingerprint).not.toBe(beforeTrack.topologyFingerprint);
    });

    it("changes a return bus's topologyFingerprint when its device chain changes", () => {
      const project = withReturnBus(
        createSliceFixtureProject(),
        "audio-projection-return-device",
      );
      const before = buildAudioProjection(project);

      const deviceId = createSeededIdFactory("audio-projection-return-device")("device");
      const edited: Project = {
        ...project,
        song: {
          ...project.song,
          returns: project.song.returns.map((bus) => ({
            ...bus,
            devices: [
              {
                id: deviceId,
                type: "filter",
                order: 0,
                bypassed: false,
                parameters: {},
                preset: null,
              },
            ],
          })),
        },
      };
      const after = buildAudioProjection(edited, before);

      expect(after.returns[0].topologyFingerprint).not.toBe(
        before.returns[0].topologyFingerprint,
      );
    });

    it("changes a return bus's fingerprint but not topologyFingerprint for a mixer volume edit", () => {
      const project = withReturnBus(
        createSliceFixtureProject(),
        "audio-projection-return-mixer",
      );
      const before = buildAudioProjection(project);

      const edited: Project = {
        ...project,
        song: {
          ...project.song,
          returns: project.song.returns.map((bus) => ({
            ...bus,
            mixer: { ...bus.mixer, volume: -6 },
          })),
        },
      };
      const after = buildAudioProjection(edited, before);

      expect(after.returns[0].topologyFingerprint).toBe(
        before.returns[0].topologyFingerprint,
      );
      expect(after.returns[0].fingerprint).not.toBe(before.returns[0].fingerprint);
      expect(after.returns[0]).not.toBe(before.returns[0]);
    });
  });

  describe("referential stability for unchanged entities", () => {
    it("reuses every track projection when nothing changed", () => {
      const project = createReferenceProject({
        trackCount: 8,
        placementCount: 16,
      });
      const before = buildAudioProjection(project);
      const after = buildAudioProjection(project, before);

      expect(after.tracks).toHaveLength(before.tracks.length);
      for (let index = 0; index < before.tracks.length; index += 1) {
        expect(after.tracks[index]).toBe(before.tracks[index]);
      }
      expect(after.clips.every((clip, i) => clip === before.clips[i])).toBe(true);
      expect(after.placements.every((p, i) => p === before.placements[i])).toBe(true);
      expect(after.automation.every((lane, i) => lane === before.automation[i])).toBe(
        true,
      );
    });

    it("reuses unrelated track projections when only one track changes", () => {
      const project = createReferenceProject({
        trackCount: 6,
        placementCount: 12,
      });
      const before = buildAudioProjection(project);
      const [changedTrack, ...untouched] = project.song.tracks;

      const edited: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: project.song.tracks.map((track) =>
            track.id === changedTrack.id
              ? { ...track, mixer: { ...track.mixer, volume: -20 } }
              : track,
          ),
        },
      };
      const after = buildAudioProjection(edited, before);

      expect(after.tracksById.get(changedTrack.id)).not.toBe(
        before.tracksById.get(changedTrack.id),
      );
      for (const track of untouched) {
        expect(after.tracksById.get(track.id)).toBe(before.tracksById.get(track.id));
      }
    });
  });

  describe("empty state", () => {
    it("projects an empty tempo-only project without error", () => {
      const project = createSliceFixtureProject();
      const emptied: Project = {
        ...project,
        song: { ...project.song, tracks: [], placements: [], automation: [] },
        clips: [],
      };
      const projection = buildAudioProjection(emptied);
      expect(projection.tracks).toEqual([]);
      expect(projection.clips).toEqual([]);
      expect(projection.placements).toEqual([]);
      expect(projection.tracksById.size).toBe(0);
    });
  });

  describe("pack-qualified assets", () => {
    it("carries each asset's owning pack and resolved version", () => {
      const project = createDrumMachineFixtureProject();
      const projection = buildAudioProjection(project);

      expect(projection.assets.map((asset) => [asset.packId, asset.packVersion])).toEqual(
        [...project.song.assets]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((asset) => [asset.packId, asset.packVersion]),
      );
      expect(new Set(projection.assets.map((asset) => asset.packId)).size).toBe(2);
    });

    it("treats a pack-version change as an asset change", () => {
      const project = createDrumMachineFixtureProject();
      const before = buildAudioProjection(project);
      const repacked: Project = {
        ...project,
        song: {
          ...project.song,
          assets: project.song.assets.map((asset, index) =>
            index === 0
              ? {
                  ...asset,
                  packVersion: "9.9.9" as (typeof asset)["packVersion"],
                }
              : asset,
          ),
        },
      };

      const after = buildAudioProjection(repacked, before);
      const assetIn = (
        projection: typeof before,
        id: (typeof project.song.assets)[number]["id"],
      ) =>
        requireDefined(
          projection.assets.find((asset) => asset.id === id),
          `asset ${id} missing from projection`,
        );

      const changed = assetIn(after, project.song.assets[0].id);
      expect(changed).not.toBe(assetIn(before, project.song.assets[0].id));
      expect(changed.packVersion).toBe("9.9.9");
      // Other assets keep their identity: a repack of one asset is not a
      // project-wide asset change.
      expect(assetIn(after, project.song.assets[1].id)).toBe(
        assetIn(before, project.song.assets[1].id),
      );
    });
  });

  describe("large fixtures", () => {
    it("builds the full 50-track reference project", () => {
      const project = createReferenceProject();
      const projection = buildAudioProjection(project);
      expect(projection.tracks).toHaveLength(50);
      expect(projection.placements).toHaveLength(project.song.placements.length);
      expect(projection.automation).toHaveLength(100);
    });
  });
});
