import { describe, expect, it } from "vitest";
import { createReferenceProject, createSliceFixtureProject } from "../domain/fixtures";
import { addToSelection, emptySelection, selectOnly } from "../selection/selection";
import { buildAssistantContext, summarizeSelection } from "./assistantContextProjection";

describe("buildAssistantContext", () => {
  it("summarizes tracks, sections, and tempo compactly", () => {
    const project = createSliceFixtureProject();
    const context = buildAssistantContext(project);

    expect(context.projectId).toBe(project.metadata.id);
    expect(context.tempo).toBe(project.song.tempo);
    expect(context.tracks).toHaveLength(1);
    expect(context.tracks[0].name).toBe(project.song.tracks[0].name);
    expect(context.tracks[0].clipCount).toBe(1);
    expect(context.tracks[0].placementCount).toBe(1);
    expect(context.selection).toBeNull();
  });

  it("never includes full per-note event data", () => {
    const project = createSliceFixtureProject();
    const context = buildAssistantContext(project);
    const serialized = JSON.stringify(context);
    // The fixture's note events use pitch 36; assert the context is compact
    // enough that it does not embed a full per-event array (only counts).
    expect(context.tracks[0]).not.toHaveProperty("clips");
    expect(serialized.length).toBeLessThan(2000);
  });

  it("does not mutate the source project", () => {
    const project = createSliceFixtureProject();
    const before = JSON.parse(JSON.stringify(project));
    buildAssistantContext(project);
    expect(JSON.parse(JSON.stringify(project))).toEqual(before);
  });

  describe("selection summary", () => {
    it("is null for an empty selection", () => {
      const project = createSliceFixtureProject();
      const context = buildAssistantContext(project, emptySelection());
      expect(context.selection).toBeNull();
    });

    it("describes a single-track selection in words, not raw scopes", () => {
      const project = createSliceFixtureProject();
      const selection = selectOnly({
        kind: "track",
        id: project.song.tracks[0].id,
      });
      const context = buildAssistantContext(project, selection);
      expect(context.selection?.description).toBe("1 track selected");
      expect(context.selection?.countByKind).toEqual({ track: 1 });
    });

    it("describes a mixed multi-selection", () => {
      const project = createSliceFixtureProject();
      let selection = selectOnly({
        kind: "track",
        id: project.song.tracks[0].id,
      });
      selection = addToSelection(selection, {
        kind: "placement",
        id: project.song.placements[0].id,
      });
      selection = addToSelection(selection, {
        kind: "clip",
        id: project.clips[0].id,
      });

      const summary = summarizeSelection(selection);
      expect(summary?.countByKind).toEqual({ track: 1, placement: 1, clip: 1 });
      expect(summary?.description).toContain("1 track");
      expect(summary?.description).toContain("1 clip");
      expect(summary?.description).toContain("1 placement");
    });

    it("pluralizes counts greater than one", () => {
      const project = createReferenceProject({
        trackCount: 4,
        placementCount: 8,
      });
      let selection = selectOnly({
        kind: "track",
        id: project.song.tracks[0].id,
      });
      selection = addToSelection(selection, {
        kind: "track",
        id: project.song.tracks[1].id,
      });
      const summary = summarizeSelection(selection);
      expect(summary?.description).toBe("2 tracks selected");
    });
  });

  describe("empty state", () => {
    it("summarizes a project with no tracks or sections", () => {
      const project = createSliceFixtureProject();
      const emptied = {
        ...project,
        song: { ...project.song, tracks: [], placements: [], sections: [] },
        clips: [],
      };
      const context = buildAssistantContext(emptied);
      expect(context.tracks).toEqual([]);
      expect(context.sections).toEqual([]);
      expect(context.totalTicks).toBe(0);
    });
  });

  describe("large fixtures", () => {
    it("summarizes the 50-track reference project", () => {
      const project = createReferenceProject();
      const context = buildAssistantContext(project);
      expect(context.tracks).toHaveLength(50);
      expect(context.sections).toHaveLength(4);
    });
  });
});
