import { describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../domain/fixtures";
import { TICKS_PER_BAR } from "../domain/time";
import {
  buildArrangementProjection,
  findRowAtOffset,
  queryPlacementsInRange,
} from "./arrangementProjection";

describe("buildArrangementProjection", () => {
  it("projects rows, clips, placements, and sections from the slice fixture", () => {
    const project = createSliceFixtureProject();
    const projection = buildArrangementProjection(project);

    expect(projection.revision).toBe(project.metadata.revision);
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0].id).toBe(project.song.tracks[0].id);
    expect(projection.rows[0].rowTop).toBe(0);
    expect(projection.clips).toHaveLength(1);
    expect(projection.placements).toHaveLength(1);
    expect(projection.totalTicks).toBe(TICKS_PER_BAR);
  });

  it("summarizes a notes clip's preview without walking every event by hand", () => {
    const project = createSliceFixtureProject();
    const projection = buildArrangementProjection(project);
    const clip = projection.clips[0];
    expect(clip.preview).toEqual({
      kind: "notes",
      noteCount: 4,
      minPitch: 36,
      maxPitch: 36,
      density: 4,
    });
  });

  it("does not mutate the source project", () => {
    const project = createSliceFixtureProject();
    const before = JSON.parse(JSON.stringify(project));
    buildArrangementProjection(project);
    expect(JSON.parse(JSON.stringify(project))).toEqual(before);
  });

  describe("row prefix sums", () => {
    it("computes cumulative row offsets in track order", () => {
      const project = createReferenceProject({
        trackCount: 4,
        placementCount: 8,
      });
      const projection = buildArrangementProjection(project, undefined, {
        rowHeight: () => 50,
      });
      expect(projection.rows.map((row) => row.rowTop)).toEqual([0, 50, 100, 150]);
      expect(projection.totalRowHeight).toBe(200);
    });

    it("finds the row at a given pixel offset via binary search", () => {
      const project = createReferenceProject({
        trackCount: 4,
        placementCount: 8,
      });
      const projection = buildArrangementProjection(project, undefined, {
        rowHeight: () => 50,
      });
      expect(findRowAtOffset(projection, 0)?.id).toBe(projection.rows[0].id);
      expect(findRowAtOffset(projection, 49)?.id).toBe(projection.rows[0].id);
      expect(findRowAtOffset(projection, 50)?.id).toBe(projection.rows[1].id);
      expect(findRowAtOffset(projection, 199)?.id).toBe(projection.rows[3].id);
    });

    it("returns null outside the row range", () => {
      const project = createReferenceProject({
        trackCount: 2,
        placementCount: 4,
      });
      const projection = buildArrangementProjection(project, undefined, {
        rowHeight: () => 50,
      });
      expect(findRowAtOffset(projection, -1)).toBeNull();
      expect(findRowAtOffset(projection, 100)).toBeNull();
    });

    it("supports variable row heights (e.g. an expanded track)", () => {
      const project = createReferenceProject({
        trackCount: 3,
        placementCount: 6,
      });
      const expandedTrackId = project.song.tracks[1].id;
      const projection = buildArrangementProjection(project, undefined, {
        rowHeight: (track) => (track.id === expandedTrackId ? 200 : 50),
      });
      expect(projection.rows.map((row) => row.rowTop)).toEqual([0, 50, 250]);
      expect(findRowAtOffset(projection, 150)?.id).toBe(expandedTrackId);
      expect(findRowAtOffset(projection, 260)?.id).toBe(projection.rows[2].id);
    });
  });

  describe("placement range queries", () => {
    it("returns only placements overlapping the requested tick range", () => {
      const project = createReferenceProject({
        trackCount: 2,
        placementCount: 20,
      });
      const trackId = project.song.tracks[0].id;
      const projection = buildArrangementProjection(project);

      const all = queryPlacementsInRange(projection, trackId, 0, Number.MAX_SAFE_INTEGER);
      const windowed = queryPlacementsInRange(
        projection,
        trackId,
        TICKS_PER_BAR * 4,
        TICKS_PER_BAR * 8,
      );

      expect(windowed.length).toBeLessThanOrEqual(all.length);
      for (const placement of windowed) {
        expect(placement.trackId).toBe(trackId);
        expect(placement.startTicks).toBeLessThan(TICKS_PER_BAR * 8);
        expect(placement.endTicks).toBeGreaterThan(TICKS_PER_BAR * 4);
      }
      // Nothing outside the window should have been included.
      const excluded = all.filter((p) => !windowed.includes(p));
      for (const placement of excluded) {
        const overlaps =
          placement.startTicks < TICKS_PER_BAR * 8 &&
          placement.endTicks > TICKS_PER_BAR * 4;
        expect(overlaps).toBe(false);
      }
    });

    it("returns an empty array for a track with no placements", () => {
      const project = createSliceFixtureProject();
      const projection = buildArrangementProjection(project);
      expect(
        queryPlacementsInRange(projection, "trk_does_not_exist" as never, 0, 100),
      ).toEqual([]);
    });
  });

  describe("referential stability for unchanged entities", () => {
    it("reuses every row, clip, and placement when nothing changed", () => {
      const project = createReferenceProject({
        trackCount: 8,
        placementCount: 16,
      });
      const before = buildArrangementProjection(project);
      const after = buildArrangementProjection(project, before);

      expect(after.rows.every((row, i) => row === before.rows[i])).toBe(true);
      expect(after.clips.every((clip, i) => clip === before.clips[i])).toBe(true);
      expect(after.placements.every((p, i) => p === before.placements[i])).toBe(true);
    });

    it("reuses unrelated rows when only one track is renamed", () => {
      const project = createReferenceProject({
        trackCount: 6,
        placementCount: 12,
      });
      const before = buildArrangementProjection(project);
      const [renamedTrack, ...untouched] = project.song.tracks;

      const edited: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: project.song.tracks.map((track) =>
            track.id === renamedTrack.id ? { ...track, name: "Renamed" } : track,
          ),
        },
      };
      const after = buildArrangementProjection(edited, before);

      // The renamed row's own display fields changed, so it rebuilds...
      expect(after.rowsById.get(renamedTrack.id)).not.toBe(
        before.rowsById.get(renamedTrack.id),
      );
      expect(after.rowsById.get(renamedTrack.id)?.name).toBe("Renamed");
      // ...but every other row is untouched, including its position.
      for (const track of untouched) {
        expect(after.rowsById.get(track.id)).toBe(before.rowsById.get(track.id));
      }
    });

    it("keeps unaffected rows stable across a two-track reorder", () => {
      const project = createReferenceProject({
        trackCount: 4,
        placementCount: 8,
      });
      const [first, second, third] = project.song.tracks;
      const before = buildArrangementProjection(project);

      const reordered: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: project.song.tracks.map((track) => {
            if (track.id === first.id) return { ...track, order: 1 };
            if (track.id === second.id) return { ...track, order: 0 };
            return track;
          }),
        },
      };
      const after = buildArrangementProjection(reordered, before);

      expect(after.rowsById.get(first.id)).not.toBe(before.rowsById.get(first.id));
      expect(after.rowsById.get(second.id)).not.toBe(before.rowsById.get(second.id));
      // The third track's own order/name/color did not change, and (since the
      // swapped rows share the default row height) its rowTop is unaffected.
      expect(after.rowsById.get(third.id)).toBe(before.rowsById.get(third.id));
    });
  });

  describe("empty state", () => {
    it("projects an empty project without error", () => {
      const project = createSliceFixtureProject();
      const emptied: Project = {
        ...project,
        song: {
          ...project.song,
          tracks: [],
          placements: [],
          sections: [],
          automation: [],
        },
        clips: [],
      };
      const projection = buildArrangementProjection(emptied);

      expect(projection.rows).toEqual([]);
      expect(projection.clips).toEqual([]);
      expect(projection.placements).toEqual([]);
      expect(projection.sections).toEqual([]);
      expect(projection.totalRowHeight).toBe(0);
      expect(projection.totalTicks).toBe(0);
      expect(findRowAtOffset(projection, 0)).toBeNull();
    });
  });

  describe("large fixtures", () => {
    it("builds the full 50-track reference project", () => {
      const project = createReferenceProject();
      const projection = buildArrangementProjection(project);

      expect(projection.rows).toHaveLength(50);
      expect(projection.placements).toHaveLength(project.song.placements.length);
      expect(projection.automation).toHaveLength(100);
      expect(projection.totalRowHeight).toBe(50 * 64);
      // Every row's own track has placements queryable through the index.
      for (const row of projection.rows) {
        const forTrack = projection.placementsByTrack.get(row.id) ?? [];
        for (let i = 1; i < forTrack.length; i += 1) {
          expect(forTrack[i].startTicks).toBeGreaterThanOrEqual(
            forTrack[i - 1].startTicks,
          );
        }
      }
    });
  });
});
