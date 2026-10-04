import { beforeEach, describe, expect, it } from "vitest";
import type { Placement, Project } from "../domain/entities";
import type { PlacementId } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { growPlacementsWithClip, placementsGrownWithClip, updateClip } from ".";
import { executeTransaction } from "./execute";
import { type CommandTestProject, createCommandTestProject } from "./testProjects";

const bars = (count: number) => toTicks(count * TICKS_PER_BAR);

/**
 * #963: lengthening a clip grows the placements that showed all of it, so the
 * arrangement plays and exports what the clip editor shows.
 */
describe("placements grown with their clip (#963)", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  /** Track A's clip placed as `spans` (the fixture's own placement replaced). */
  function withPlacements(
    spans: readonly (Partial<Omit<Placement, "id">> & { id: string })[],
  ): Project {
    const template = fixture.project.song.placements.find(
      (placement) => placement.id === fixture.placementAId,
    ) as Placement;
    const others = fixture.project.song.placements.filter(
      (placement) => placement.id !== fixture.placementAId,
    );
    const placements = spans.map(
      (span) => ({ ...template, ...span, id: span.id as PlacementId }) as Placement,
    );
    return {
      ...fixture.project,
      song: { ...fixture.project.song, placements: [...others, ...placements] },
    };
  }

  function grownDurations(project: Project, toLength: number): Record<string, number> {
    return Object.fromEntries(
      placementsGrownWithClip(project, fixture.clipAId, bars(1), toLength).map(
        (placement) => [placement.id, placement.durationTicks],
      ),
    );
  }

  it("grows a placement that showed the whole clip to the new length", () => {
    const project = withPlacements([{ id: "plc_a" }]);
    expect(grownDurations(project, bars(32))).toEqual({ plc_a: bars(32) });
  });

  it("stops at the next placement on the track", () => {
    const project = withPlacements([
      { id: "plc_a", startTicks: bars(0) },
      { id: "plc_b", startTicks: bars(4), clipOffsetTicks: toTicks(0) },
    ]);
    // plc_a has three bars of room; plc_b has the rest of the track.
    expect(grownDurations(project, bars(8))).toEqual({
      plc_a: bars(4),
      plc_b: bars(8),
    });
  });

  it("leaves a placement with no room, a looped one and a partial one alone", () => {
    const project = withPlacements([
      { id: "plc_tile", startTicks: bars(0) },
      { id: "plc_last", startTicks: bars(1) },
      { id: "plc_loop", startTicks: bars(10), looped: true },
      {
        id: "plc_part",
        startTicks: bars(20),
        durationTicks: toTicks(TICKS_PER_BAR / 2),
      },
    ]);
    expect(grownDurations(project, bars(2))).toEqual({ plc_last: bars(2) });
  });

  it("grows a head-trimmed placement to the clip's new end", () => {
    const half = TICKS_PER_BAR / 2;
    const project = withPlacements([
      { id: "plc_a", clipOffsetTicks: toTicks(half), durationTicks: toTicks(half) },
    ]);
    expect(grownDurations(project, bars(2))).toEqual({ plc_a: bars(2) - half });
  });

  it("grows nothing when the clip shortens or keeps its length", () => {
    const project = withPlacements([{ id: "plc_a", durationTicks: bars(4) }]);
    expect(placementsGrownWithClip(project, fixture.clipAId, bars(4), bars(1))).toEqual(
      [],
    );
    expect(placementsGrownWithClip(project, fixture.clipAId, bars(4), bars(4))).toEqual(
      [],
    );
  });

  it("resizes and grows as one transaction that undoes exactly", () => {
    const { project } = fixture;
    const result = executeTransaction(project, [
      updateClip(fixture.clipAId, { lengthTicks: bars(32) }),
      ...growPlacementsWithClip(project, fixture.clipAId, bars(32)),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const placementA = (p: Project) =>
      p.song.placements.find((placement) => placement.id === fixture.placementAId);
    expect(placementA(result.project)?.durationTicks).toBe(bars(32));
    expect(result.revision).toBe(project.metadata.revision + 1);

    const undone = executeTransaction(result.project, result.inverse);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(placementA(undone.project)?.durationTicks).toBe(bars(1));
  });
});
