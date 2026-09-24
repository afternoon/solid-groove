import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Project } from "../domain/entities";
import { createSeededIdFactory, type PlacementId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { buildArrangementProject } from "../testing/arrangementProject";
import { removePlacementRange } from "./placementRangeEdits";

const BAR = TICKS_PER_BAR;

/** Apply the removal as one transaction, as the controller will. */
function removeRange(
  project: Project,
  placementIds: readonly PlacementId[],
  start: number,
  end: number,
) {
  const removal = removePlacementRange(
    project,
    placementIds,
    start,
    end,
    createSeededIdFactory("range"),
  );
  const result = executeTransaction(project, removal.commands);
  if (!result.ok) throw new Error(`transaction rejected: ${JSON.stringify(result)}`);
  return { removal, after: result.project };
}

/** Each placement as `[start, duration, clipOffset]`, in song order. */
function spans(project: Project) {
  return project.song.placements.map((p) => [
    p.startTicks,
    p.durationTicks,
    p.clipOffsetTicks,
  ]);
}

describe("removing a stretch of time from placements (#292)", () => {
  it("removes a clip wholly inside the range and trims one partly inside it (CF-010)", () => {
    // BD: bars 1 and 3. Track 2: one clip across bars 1 to 3.
    const { project, placementIds } = buildArrangementProject([
      [
        { startTicks: 0, durationTicks: BAR },
        { startTicks: 2 * BAR, durationTicks: BAR },
      ],
      [{ startTicks: 0, durationTicks: 3 * BAR }],
    ]);
    const covered = [placementIds[0][1], placementIds[1][0]];
    const { after } = removeRange(project, covered, 1164, 2700);

    const ids = after.song.placements.map((p) => p.id);
    expect(ids).toEqual([placementIds[0][0], placementIds[1][0]]);
    // BD's bar-1 clip is untouched, and the long clip now stops where the range began.
    expect(spans(after)).toEqual([
      [0, BAR, 0],
      [0, 1164, 0],
    ]);
  });

  it("trims a clip's head, moving its content offset along with its start", () => {
    const { project, placementIds } = buildArrangementProject([
      [{ startTicks: BAR, durationTicks: 2 * BAR, clipOffsetTicks: 10 }],
    ]);
    const { after } = removeRange(project, placementIds[0], 0, BAR + 100);
    expect(spans(after)).toEqual([[BAR + 100, 2 * BAR - 100, 110]]);
  });

  it("splits a clip the range falls strictly inside, keeping both sides", () => {
    const { project, placementIds } = buildArrangementProject([
      [{ startTicks: 0, durationTicks: 4 * BAR }],
    ]);
    const { after } = removeRange(project, placementIds[0], BAR, 2 * BAR + 12);
    expect(spans(after)).toEqual([
      [0, BAR, 0],
      [2 * BAR + 12, 2 * BAR - 12, 2 * BAR + 12],
    ]);
    const [head, tail] = after.song.placements;
    expect(tail.clipId).toBe(head.clipId);
    expect(tail.id).not.toBe(head.id);
  });

  it("hands back the covered pieces for a cut's clipboard", () => {
    const { project, placementIds } = buildArrangementProject([
      [{ startTicks: 0, durationTicks: 2 * BAR, clipOffsetTicks: 5 }],
    ]);
    const { removal } = removeRange(project, placementIds[0], BAR, 3 * BAR);
    const [clip] = project.clips;
    expect(removal.clipboard).toEqual([
      {
        clipId: clip.id,
        trackId: project.song.tracks[0].id,
        startTicks: BAR,
        durationTicks: BAR,
        clipOffsetTicks: BAR + 5,
        looped: false,
      },
    ]);
  });

  it("changes nothing for a clip the range misses, a missing clip, or an empty range", () => {
    const { project, placementIds } = buildArrangementProject([
      [{ startTicks: 0, durationTicks: BAR }],
    ]);
    const ids = createSeededIdFactory("range");
    const gone = "plc_gone" as PlacementId;
    expect(removePlacementRange(project, placementIds[0], BAR, 2 * BAR, ids)).toEqual({
      commands: [],
      clipboard: [],
    });
    expect(removePlacementRange(project, [gone], 0, BAR, ids).commands).toEqual([]);
    expect(
      removePlacementRange(project, placementIds[0], 300, 300, ids).commands,
    ).toEqual([]);
  });
});
