import { describe, expect, it } from "vitest";
import type { TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { buildArrangementProject } from "../testing/arrangementProject";
import {
  bandBetween,
  barStartPoint,
  clipsSelection,
  placementsTouchedBy,
  pointSelection,
  reconcileArrangementSelection,
  selectedPlacementIds,
  selectionSpan,
  selectionStartTicks,
} from "./arrangement";

const BAR = TICKS_PER_BAR;

/** CF-010's layout. BD: clips in bars 1 and 3. Track 2: one clip across bars 1 to 3. */
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
  it("builds a point in whole ticks, and a click's point at the start of its bar", () => {
    const { trackIds } = twoTracks();
    expect(pointSelection({ trackId: trackIds[0], ticks: 1548.4 })).toEqual({
      kind: "point",
      trackId: trackIds[0],
      ticks: 1548,
    });
    // Anywhere in bar 3 is 3.1.1 (CF-009 step 3), and a bar line stays put.
    expect(barStartPoint({ trackId: trackIds[0], ticks: 2.5 * BAR })).toEqual(
      pointSelection({ trackId: trackIds[0], ticks: 2 * BAR }),
    );
    expect(barStartPoint({ trackId: trackIds[1], ticks: BAR })).toEqual(
      pointSelection({ trackId: trackIds[1], ticks: BAR }),
    );
  });

  it("builds a band from two corners in either order, over every track between", () => {
    const { project, trackIds } = twoTracks();
    const forward = bandBetween(
      project,
      { trackId: trackIds[0], ticks: 1164 },
      { trackId: trackIds[1], ticks: 2700 },
    );
    const backward = bandBetween(
      project,
      { trackId: trackIds[1], ticks: 2700 },
      { trackId: trackIds[0], ticks: 1164 },
    );
    expect(forward).toEqual({
      trackIds: [...trackIds],
      startTicks: 1164,
      endTicks: 2700,
    });
    expect(backward).toEqual(forward);
    const gone = "trk_gone" as TrackId;
    expect(
      bandBetween(
        project,
        { trackId: trackIds[0], ticks: 0 },
        { trackId: gone, ticks: 9 },
      ),
    ).toBeNull();
  });

  it("touches every clip a band contains or overlaps, but not one it only meets (CF-010)", () => {
    const { project, trackIds, placementIds } = twoTracks();
    const band = bandBetween(
      project,
      { trackId: trackIds[0], ticks: 1164 },
      { trackId: trackIds[1], ticks: 2700 },
    );
    if (!band) throw new Error("expected a band");
    // BD's bar-3 clip, wholly inside, and the overlapped clip on track 2. Not
    // BD's bar-1 clip, which ends before the band begins.
    expect(placementsTouchedBy(band, project)).toEqual([
      placementIds[0][1],
      placementIds[1][0],
    ]);
    const edgeToEdge = { trackIds: [trackIds[0]], startTicks: BAR, endTicks: 2 * BAR };
    expect(placementsTouchedBy(edgeToEdge, project)).toEqual([]);
    const zeroWidth = { trackIds: [...trackIds], startTicks: BAR, endTicks: BAR };
    expect(placementsTouchedBy(zeroWidth, project)).toEqual([]);
  });

  it("gives clips their extent and a paste start; a point has no extent", () => {
    const { project, trackIds, placementIds } = twoTracks();
    const clips = clipsSelection([placementIds[1][0], placementIds[0][1]]);
    expect(selectedPlacementIds(clips, project)).toEqual([
      placementIds[0][1],
      placementIds[1][0],
    ]);
    expect(selectionSpan(clips, project)).toEqual({ startTicks: 0, endTicks: 3 * BAR });
    expect(selectionStartTicks(clips, project)).toBe(0);

    const point = pointSelection({ trackId: trackIds[1], ticks: 4 * BAR });
    expect(selectedPlacementIds(point, project)).toEqual([]);
    expect(selectionSpan(point, project)).toBeNull();
    expect(selectionStartTicks(point, project)).toBe(4 * BAR);
    expect(selectionSpan(null, project)).toBeNull();
    expect(selectionStartTicks(null, project)).toBeNull();
  });

  it("drops duplicate clips, and makes no empty clip selection", () => {
    const id = twoTracks().placementIds[0][0];
    expect(clipsSelection([id, id])).toEqual({ kind: "clips", placementIds: [id] });
    expect(clipsSelection([])).toBeNull();
  });

  describe("reconciling against a changed project", () => {
    it("keeps the same reference when everything is still there", () => {
      const { project, trackIds, placementIds } = twoTracks();
      const clips = clipsSelection(placementIds[0]);
      const point = pointSelection({ trackId: trackIds[1], ticks: 10 });
      expect(reconcileArrangementSelection(clips, project)).toBe(clips);
      expect(reconcileArrangementSelection(point, project)).toBe(point);
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

    it("drops a point whose track is gone", () => {
      const { project, trackIds } = twoTracks();
      const oneTrack = {
        ...project,
        song: { ...project.song, tracks: project.song.tracks.slice(0, 1) },
      };
      const onSecond = pointSelection({ trackId: trackIds[1], ticks: 0 });
      expect(reconcileArrangementSelection(onSecond, oneTrack)).toBeNull();
    });
  });
});
