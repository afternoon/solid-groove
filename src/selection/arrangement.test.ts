import { describe, expect, it } from "vitest";
import type { TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { buildArrangementProject } from "../testing/arrangementProject";
import {
  clipsSelection,
  coveredPlacementIds,
  isPointSelection,
  pointSelection,
  rangeSelection,
  reconcileArrangementSelection,
  selectionSpan,
} from "./arrangement";

const BAR = TICKS_PER_BAR;

/** BD: clips in bars 1 and 3. Track 2: one clip across bars 1 to 3. */
function twoTracks() {
  return buildArrangementProject([
    [
      { startTicks: 0, durationTicks: BAR },
      { startTicks: 2 * BAR, durationTicks: BAR },
    ],
    [{ startTicks: 0, durationTicks: 3 * BAR }],
  ]);
}

describe("the arrangement selection (#292)", () => {
  it("builds a point as a zero-length range on one track, in whole ticks", () => {
    const { trackIds } = twoTracks();
    const point = pointSelection({ trackId: trackIds[0], ticks: 1548.4 });
    expect(point).toEqual({
      kind: "range",
      span: { trackIds: [trackIds[0]], startTicks: 1548, endTicks: 1548 },
    });
    expect(isPointSelection(point)).toBe(true);
  });

  it("builds a range from two corners in either order, covering every track between", () => {
    const { project, trackIds } = twoTracks();
    const forward = rangeSelection(
      project,
      { trackId: trackIds[0], ticks: 1164 },
      { trackId: trackIds[1], ticks: 2700 },
    );
    const backward = rangeSelection(
      project,
      { trackId: trackIds[1], ticks: 2700 },
      { trackId: trackIds[0], ticks: 1164 },
    );
    expect(forward).toEqual({
      kind: "range",
      span: { trackIds: [...trackIds], startTicks: 1164, endTicks: 2700 },
    });
    expect(backward).toEqual(forward);
    expect(isPointSelection(forward)).toBe(false);
  });

  it("refuses a range whose corner is on a track the project does not have", () => {
    const { project, trackIds } = twoTracks();
    const gone = "trk_gone" as TrackId;
    expect(
      rangeSelection(
        project,
        { trackId: trackIds[0], ticks: 0 },
        { trackId: gone, ticks: 9 },
      ),
    ).toBeNull();
  });

  it("selects every clip a range touches, including one only partly inside it", () => {
    const { project, trackIds, placementIds } = twoTracks();
    const range = rangeSelection(
      project,
      { trackId: trackIds[0], ticks: 1164 },
      { trackId: trackIds[1], ticks: 2700 },
    );
    // Not BD's bar-1 clip, which ends before the range begins.
    expect(coveredPlacementIds(range, project)).toEqual([
      placementIds[0][1],
      placementIds[1][0],
    ]);
  });

  it("does not select a clip that only touches the range's edge, and a point selects nothing", () => {
    const { project, trackIds } = twoTracks();
    const edgeToEdge = rangeSelection(
      project,
      { trackId: trackIds[0], ticks: BAR },
      { trackId: trackIds[0], ticks: 2 * BAR },
    );
    expect(coveredPlacementIds(edgeToEdge, project)).toEqual([]);
    const inside = pointSelection({ trackId: trackIds[1], ticks: BAR });
    expect(coveredPlacementIds(inside, project)).toEqual([]);
    expect(coveredPlacementIds(null, project)).toEqual([]);
  });

  it("gives a clip selection the span of its clips, across their tracks", () => {
    const { project, trackIds, placementIds } = twoTracks();
    const clips = clipsSelection([placementIds[1][0], placementIds[0][1]]);
    expect(coveredPlacementIds(clips, project)).toEqual([
      placementIds[0][1],
      placementIds[1][0],
    ]);
    expect(selectionSpan(clips, project)).toEqual({
      trackIds: [...trackIds],
      startTicks: 0,
      endTicks: 3 * BAR,
    });
    // No clip twice, and no empty clip selection.
    const id = placementIds[0][0];
    expect(clipsSelection([id, id])).toEqual({ kind: "clips", placementIds: [id] });
    expect(clipsSelection([])).toBeNull();
  });

  it("gives a range its own span, even where it runs past its clips", () => {
    const { project, trackIds } = twoTracks();
    const range = rangeSelection(
      project,
      { trackId: trackIds[0], ticks: 1152 },
      { trackId: trackIds[1], ticks: 5 * BAR },
    );
    expect(selectionSpan(range, project)).toEqual({
      trackIds: [...trackIds],
      startTicks: 1152,
      endTicks: 5 * BAR,
    });
    expect(selectionSpan(null, project)).toBeNull();
  });

  describe("reconciling against a changed project", () => {
    it("keeps the same reference when everything is still there", () => {
      const { project, trackIds, placementIds } = twoTracks();
      const clips = clipsSelection(placementIds[0]);
      const range = pointSelection({ trackId: trackIds[1], ticks: 10 });
      expect(reconcileArrangementSelection(clips, project)).toBe(clips);
      expect(reconcileArrangementSelection(range, project)).toBe(range);
      expect(reconcileArrangementSelection(null, project)).toBeNull();
    });

    it("drops a clip that is gone, and the whole selection when none is left", () => {
      const { project, placementIds } = twoTracks();
      const [first, second] = placementIds[0];
      const without = {
        ...project,
        song: {
          ...project.song,
          placements: project.song.placements.filter((p) => p.id !== first),
        },
      };
      expect(
        reconcileArrangementSelection(clipsSelection([first, second]), without),
      ).toEqual({ kind: "clips", placementIds: [second] });
      expect(reconcileArrangementSelection(clipsSelection([first]), without)).toBeNull();
    });

    it("narrows a range to the tracks that are left, and drops it when none is", () => {
      const { project, trackIds } = twoTracks();
      const range = rangeSelection(
        project,
        { trackId: trackIds[0], ticks: 0 },
        { trackId: trackIds[1], ticks: BAR },
      );
      const oneTrack = {
        ...project,
        song: { ...project.song, tracks: project.song.tracks.slice(0, 1) },
      };
      const noTracks = { ...project, song: { ...project.song, tracks: [] } };
      expect(reconcileArrangementSelection(range, oneTrack)).toEqual({
        kind: "range",
        span: { trackIds: [trackIds[0]], startTicks: 0, endTicks: BAR },
      });
      expect(reconcileArrangementSelection(range, noTracks)).toBeNull();
    });
  });
});
