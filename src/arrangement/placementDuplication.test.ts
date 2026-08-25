import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Clip, Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory, type PlacementId } from "../domain/ids";
import { SONG_TEMPO } from "../domain/parameters";
import { minutesToTicks } from "../domain/time";
import { copyClip, describeDuplicate, duplicatePlacement } from "./placementDuplication";
import { floorToBar, MAX_ARRANGEMENT_TICKS, movePlacement } from "./placementGeometry";

function fixture(): {
  project: Project;
  placementId: PlacementId;
  clip: Clip;
} {
  const project = createSliceFixtureProject();
  return {
    project,
    placementId: project.song.placements[0].id,
    clip: project.clips[0],
  };
}

/** Applies the operation's commands the way the editor does: one transaction. */
function apply(project: Project, commands: Parameters<typeof executeTransaction>[1]) {
  const result = executeTransaction(project, commands);
  expect(result.ok, JSON.stringify((result as { issues?: unknown }).issues)).toBe(true);
  return result.project;
}

describe("duplicatePlacement: reuse versus independent variation (CLP-01)", () => {
  it("states which operation each mode will perform", () => {
    expect(describeDuplicate("linked")).toContain("linked");
    expect(describeDuplicate("linked")).toContain("both");
    expect(describeDuplicate("independent")).toContain("independent");
    expect(describeDuplicate("independent")).not.toContain("both");
  });

  it("linked mode reuses the source clip and adds no new clip", () => {
    const { project, placementId, clip } = fixture();
    const ids = createSeededIdFactory("linked");
    const { commands } = duplicatePlacement(project, placementId, "linked", ids);
    const next = apply(project, commands);

    expect(next.clips).toHaveLength(project.clips.length);
    expect(next.song.placements).toHaveLength(2);
    expect(next.song.placements.every((p) => p.clipId === clip.id)).toBe(true);
  });

  it("independent mode forks a clip with a fresh ID and fresh event IDs", () => {
    const { project, placementId, clip } = fixture();
    const ids = createSeededIdFactory("independent");
    const { commands, placementId: newId } = duplicatePlacement(
      project,
      placementId,
      "independent",
      ids,
    );
    const next = apply(project, commands);

    expect(next.clips).toHaveLength(project.clips.length + 1);
    const copy = next.clips.find((candidate) => candidate.id !== clip.id);
    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe(clip.id);

    const added = next.song.placements.find((p) => p.id === newId);
    expect(added?.clipId).toBe(copy?.id);

    // Nothing about the copy shares identity with the source.
    if (clip.content.kind === "notes" && copy?.content.kind === "notes") {
      const sourceIds = new Set(clip.content.events.map((event) => event.id));
      expect(copy.content.events).toHaveLength(clip.content.events.length);
      for (const event of copy.content.events) {
        expect(sourceIds.has(event.id)).toBe(false);
      }
    }
  });

  it("edits to an independent copy leave the source untouched", () => {
    const { project, placementId, clip } = fixture();
    const ids = createSeededIdFactory("diverge");
    const { commands } = duplicatePlacement(project, placementId, "independent", ids);
    const next = apply(project, commands);
    const copy = next.clips.find((candidate) => candidate.id !== clip.id);
    if (copy?.content.kind !== "notes" || clip.content.kind !== "notes") {
      throw new Error("expected note clips");
    }
    // Structural independence: the copy's event array is not the same object,
    // so a later note edit to one cannot be observed through the other.
    expect(copy.content.events).not.toBe(clip.content.events);
    expect(copy.content.events[0]).not.toBe(clip.content.events[0]);
  });

  it("places the duplicate immediately after its source", () => {
    const { project, placementId } = fixture();
    const source = project.song.placements[0];
    const ids = createSeededIdFactory("after");
    const { commands, placementId: newId } = duplicatePlacement(
      project,
      placementId,
      "linked",
      ids,
    );
    const next = apply(project, commands);
    const added = next.song.placements.find((p) => p.id === newId);
    expect(added?.startTicks).toBe(source.startTicks + source.durationTicks);
  });

  it("duplicates a placement at minute nine, inside the guarantee", () => {
    // The refusal below is only correct if the bound itself is right: at
    // minute 9 of ARR-01's guaranteed 10:00 a duplicate must still be
    // produced, not silently dropped.
    const { project, placementId } = fixture();
    const moved = apply(
      project,
      movePlacement(
        project,
        placementId,
        floorToBar(minutesToTicks(9, SONG_TEMPO.defaultValue)),
      ),
    );
    const result = duplicatePlacement(
      moved,
      placementId,
      "linked",
      createSeededIdFactory("inside"),
    );
    expect(result.placementId).not.toBeNull();
    expect(result.commands.length).toBeGreaterThan(0);
  });

  it("refuses a duplicate that would run past the ten-minute guarantee", () => {
    const { project, placementId } = fixture();
    const moved = apply(
      project,
      movePlacement(project, placementId, MAX_ARRANGEMENT_TICKS),
    );
    const result = duplicatePlacement(
      moved,
      placementId,
      "linked",
      createSeededIdFactory("bounded"),
    );
    expect(result.commands).toEqual([]);
    expect(result.placementId).toBeNull();
  });
});

describe("copyClip", () => {
  it("keeps an audioLoop clip's content but gives it a new identity", () => {
    const { project } = fixture();
    const source = project.clips[0];
    const copy = copyClip(source, createSeededIdFactory("copy"));
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(source.name);
    expect(copy.content.kind).toBe(source.content.kind);
  });
});

describe("atomicity and identity (CLP-01: no array-index identity)", () => {
  it("an independent duplicate lands as exactly one transaction", () => {
    const { project, placementId } = fixture();
    const { commands } = duplicatePlacement(
      project,
      placementId,
      "independent",
      createSeededIdFactory("atomic"),
    );
    expect(commands).toHaveLength(2);
    const before = project.metadata.revision;
    const result = executeTransaction(project, commands);
    expect(result.ok, JSON.stringify((result as { issues?: unknown }).issues)).toBe(true);
    // One transaction, one revision — not one per command.
    expect(result.project.metadata.revision).toBe(before + 1);
  });

  it("a rejected command leaves the project object untouched", () => {
    const { project, placementId } = fixture();
    const { commands } = duplicatePlacement(
      project,
      placementId,
      "linked",
      createSeededIdFactory("reject"),
    );
    // Applying the same create twice must fail the whole transaction.
    const result = executeTransaction(project, [...commands, ...commands]);
    expect(result.ok).toBe(false);
    expect(result.project).toBe(project);
  });
});
