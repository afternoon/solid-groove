import { describe, expect, it } from "vitest";
import type { PlacementId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { clipsSelection, pointSelection, rangeSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import {
  describeArrangementSelection,
  describeSpan,
  formatPosition,
} from "./selectionAnnouncement";

const BAR = TICKS_PER_BAR;
const SIXTEENTH = BAR / 16;

/** A quarter of the way into sixteenth `bar.beat.sixteenth`, as the flows aim. */
const inside = (bar: number, beat: number, sixteenth: number) =>
  (bar - 1) * BAR + (beat - 1) * 4 * SIXTEENTH + (sixteenth - 1) * SIXTEENTH + 12;

/** CF-010's layout. BD: bars 1 and 3. Track 2 (renamed "Sampler"): bars 1 to 3. */
function cf010() {
  const built = buildArrangementProject([
    [
      { startTicks: 0, durationTicks: BAR },
      { startTicks: 2 * BAR, durationTicks: BAR },
    ],
    [{ startTicks: 0, durationTicks: 3 * BAR }],
  ]);
  const tracks = built.project.song.tracks.map((track, index) =>
    index === 1 ? { ...track, name: "Sampler" } : track,
  );
  return {
    ...built,
    project: { ...built.project, song: { ...built.project.song, tracks } },
  };
}

describe("positions and spans", () => {
  it("names a position 1-based, by the sixteenth it falls in", () => {
    expect(formatPosition(0)).toBe("1.1.1");
    expect(formatPosition(inside(3, 1, 2))).toBe("3.1.2");
    expect(formatPosition(inside(3, 4, 4))).toBe("3.4.4");
    expect(formatPosition(BAR - 1)).toBe("1.4.4");
  });

  it("names a span on bar lines by whole bars, counting the last bar it occupies", () => {
    expect(describeSpan(0, BAR)).toBe("bar 1");
    expect(describeSpan(2 * BAR, 3 * BAR)).toBe("bar 3");
    expect(describeSpan(0, 3 * BAR)).toBe("bars 1 to 3");
  });

  it("names any other span by the position of each end", () => {
    expect(describeSpan(0, 1164)).toBe("1.1.1 to 2.3.1");
    expect(describeSpan(inside(2, 4, 1), inside(4, 4, 1))).toBe("2.4.1 to 4.4.1");
    // One end on a bar line is not enough for whole bars.
    expect(describeSpan(BAR, BAR + SIXTEENTH)).toBe("2.1.1 to 2.1.2");
  });
});

describe("the arrangement selection announcement (#292)", () => {
  it("says there is nothing selected", () => {
    const { project } = cf010();
    expect(describeArrangementSelection(null, project)).toBe("No selection");
    const gone = clipsSelection(["plc_gone" as PlacementId]);
    expect(describeArrangementSelection(gone, project)).toBe("No selection");
  });

  it("names one clip by its track and its bars (CF-009, CF-010)", () => {
    const { project, placementIds } = cf010();
    const say = (id: PlacementId) =>
      describeArrangementSelection(clipsSelection([id]), project);
    expect(say(placementIds[0][0])).toBe("Selected clip on BD, bar 1");
    expect(say(placementIds[0][1])).toBe("Selected clip on BD, bar 3");
    expect(say(placementIds[1][0])).toBe("Selected clip on Sampler, bars 1 to 3");
  });

  it("names a point by its position (CF-009)", () => {
    const { project, trackIds } = cf010();
    const point = pointSelection({ trackId: trackIds[0], ticks: inside(3, 1, 1) });
    expect(describeArrangementSelection(point, project)).toBe("Position 3.1.1");
  });

  it("counts the clips a range touches when there are several (CF-010)", () => {
    const { project, trackIds } = cf010();
    const range = rangeSelection(
      project,
      { trackId: trackIds[0], ticks: inside(2, 3, 1) },
      { trackId: trackIds[1], ticks: inside(4, 3, 1) },
    );
    expect(describeArrangementSelection(range, project)).toBe("2 clips selected");
  });

  it("names a range touching one clip as that clip", () => {
    const { project, trackIds } = cf010();
    // What the accessible list's "Select BD" sets: bar 1, exactly.
    const range = rangeSelection(
      project,
      { trackId: trackIds[0], ticks: 0 },
      { trackId: trackIds[0], ticks: BAR },
    );
    expect(describeArrangementSelection(range, project)).toBe(
      "Selected clip on BD, bar 1",
    );
  });

  it("names a range covering no clip by its tracks and its ends (CF-009, CF-010)", () => {
    const { project, trackIds } = cf010();
    const say = (fromTrack: number, from: number, toTrack: number, to: number) =>
      describeArrangementSelection(
        rangeSelection(
          project,
          { trackId: trackIds[fromTrack], ticks: from },
          { trackId: trackIds[toTrack], ticks: to },
        ),
        project,
      );
    expect(say(0, inside(3, 1, 2) + 2 * BAR, 0, inside(3, 4, 4) + 2 * BAR)).toBe(
      "Selected BD, 5.1.2 to 5.4.4",
    );
    expect(say(0, 4 * BAR, 0, 5 * BAR)).toBe("Selected BD, bar 5");
    expect(say(0, 4 * BAR + 12, 1, 5 * BAR + 12)).toBe(
      "Selected 2 tracks, 5.1.1 to 6.1.1",
    );
  });
});
