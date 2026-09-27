import { describe, expect, it } from "vitest";
import type { PlacementId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { barStartPoint, clipsSelection, pointSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import {
  describeArrangementSelection,
  describeSpan,
  formatPosition,
} from "./selectionAnnouncement";

const BAR = TICKS_PER_BAR;
const SIXTEENTH = BAR / 16;

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
    expect(formatPosition(2 * BAR + SIXTEENTH + 12)).toBe("3.1.2");
    expect(formatPosition(BAR - 1)).toBe("1.4.4");
  });

  it("names a span on bar lines by whole bars, counting the last bar it occupies", () => {
    expect(describeSpan(0, BAR)).toBe("bar 1");
    expect(describeSpan(2 * BAR, 3 * BAR)).toBe("bar 3");
    expect(describeSpan(0, 3 * BAR)).toBe("bars 1 to 3");
  });

  it("names any other span by the position of each end", () => {
    expect(describeSpan(0, 1164)).toBe("1.1.1 to 2.3.1");
    // One end on a bar line is not enough for whole bars.
    expect(describeSpan(BAR, BAR + SIXTEENTH)).toBe("2.1.1 to 2.1.2");
  });
});

describe("the arrangement selection announcement (#292)", () => {
  it("says there is nothing selected, including for clips that are gone", () => {
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

  it("counts several clips (CF-010, CF-011)", () => {
    const { project, placementIds } = cf010();
    const both = clipsSelection([placementIds[0][1], placementIds[1][0]]);
    expect(describeArrangementSelection(both, project)).toBe("2 clips selected");
  });

  it("names a point by its position (CF-009, CF-010)", () => {
    const { project, trackIds } = cf010();
    const clicked = barStartPoint({ trackId: trackIds[0], ticks: 2.5 * BAR });
    expect(describeArrangementSelection(clicked, project)).toBe("Position 3.1.1");
    const exact = pointSelection({ trackId: trackIds[1], ticks: BAR + 4 * SIXTEENTH });
    expect(describeArrangementSelection(exact, project)).toBe("Position 2.2.1");
  });
});
