/**
 * The pure half of Alt-drag copy (ARR-011): planning independent copies,
 * placing them at one offset, and resolving the drop's overwrite (#290).
 */

import { describe, expect, it } from "vitest";
import { addPlacement } from "../commands/definitions/placements";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory, type PlacementId } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import {
  clampCopyOffset,
  dragCopyCommands,
  dragCopyOverwrites,
  planDragCopy,
} from "./placementDragCopy";
import { MAX_ARRANGEMENT_TICKS } from "./placementGeometry";

const BAR = TICKS_PER_BAR;

function apply(project: Project, commands: readonly RawCommandInput[]): Project {
  const result = executeTransaction(project, commands);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

function setup() {
  const ids = createSeededIdFactory("drag-copy-plan");
  const project = createSliceFixtureProject();
  const source = project.song.placements[0];
  const plan = planDragCopy(project, [source.id], ids);
  return { ids, project, source, plan };
}

describe("planDragCopy", () => {
  it("mints a fresh clip, placement and event ID for every copy", () => {
    const { project, source, plan } = setup();
    expect(plan).toHaveLength(1);
    const [copy] = plan;
    expect(copy.source).toBe(source);
    expect(copy.placementId).not.toBe(source.id);
    expect(copy.clip.id).not.toBe(source.clipId);
    const original = project.clips.find((clip) => clip.id === source.clipId);
    if (original?.content.kind !== "notes" || copy.clip.content.kind !== "notes") {
      throw new Error("expected note clips");
    }
    const originalEvents = original.content.events.map((event) => event.id);
    expect(copy.clip.content.events.map((event) => event.id)).not.toContain(
      originalEvents[0],
    );
  });

  it("skips a placement the project does not contain", () => {
    const { ids, project } = setup();
    expect(planDragCopy(project, ["plc_missing" as PlacementId], ids)).toEqual([]);
  });
});

describe("clampCopyOffset", () => {
  it("keeps every copy inside the song", () => {
    const { plan, source } = setup();
    expect(clampCopyOffset(plan, 2 * BAR)).toBe(2 * BAR);
    expect(clampCopyOffset(plan, -5 * BAR)).toBe(-source.startTicks);
    expect(clampCopyOffset(plan, MAX_ARRANGEMENT_TICKS)).toBe(
      MAX_ARRANGEMENT_TICKS - source.startTicks - source.durationTicks,
    );
  });
});

describe("dragCopyCommands", () => {
  it("creates the copies once, then moves them, leaving the original put", () => {
    const { project, source, plan } = setup();
    const created = apply(project, dragCopyCommands(plan, 2 * BAR, null));
    const moved = apply(created, dragCopyCommands(plan, 4 * BAR, 2 * BAR));
    expect(dragCopyCommands(plan, 4 * BAR, 4 * BAR)).toEqual([]);

    expect(moved.clips).toHaveLength(project.clips.length + 1);
    const starts = moved.song.placements.map((p) => [p.id, p.startTicks]);
    expect(starts).toEqual([
      [source.id, source.startTicks],
      [plan[0].placementId, source.startTicks + 4 * BAR],
    ]);
  });
});

describe("dragCopyOverwrites", () => {
  it("removes what a copy covers once it lands, and nothing else", () => {
    const { ids, project, source, plan } = setup();
    const neighbour = { ...source, id: ids("placement"), startTicks: toTicks(4 * BAR) };
    const withNeighbour = apply(project, [addPlacement(neighbour)]);
    const landed = executeTransaction(
      withNeighbour,
      dragCopyCommands(plan, 4 * BAR - source.startTicks, null),
      { deferredInvariants: ["placement_overlap"] },
    );
    if (!landed.ok) throw new Error(JSON.stringify(landed.issues));

    const overwrite = dragCopyOverwrites(landed.project, plan, () => ids("placement"));
    const resolved = apply(landed.project, overwrite);
    expect(resolved.song.placements.map((p) => p.id)).toEqual([
      source.id,
      plan[0].placementId,
    ]);
  });

  it("is empty when the copies land on free bars", () => {
    const { ids, project, plan } = setup();
    const landed = apply(project, dragCopyCommands(plan, 8 * BAR, null));
    expect(dragCopyOverwrites(landed, plan, () => ids("placement"))).toEqual([]);
  });
});
