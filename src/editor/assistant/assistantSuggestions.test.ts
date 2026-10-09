import { describe, expect, it } from "vitest";
import { createSliceFixtureProject } from "../../domain/fixtures";
import type { EventId, PlacementId } from "../../domain/ids";
import type { Suggestion } from "../../projection/projectAnalysisProjection";
import { resolveScope, type ScopeSources } from "./assistantScope";
import {
  assistantSuggestions,
  focusedSuggestions,
  MAX_SHOWN,
  rankSuggestions,
} from "./assistantSuggestions";

const suggestion = (id: Suggestion["id"], scope: Suggestion["scope"]): Suggestion => ({
  id,
  scope,
  label: id,
  rationale: "",
});

const ALL = [
  suggestion("fill_empty_track", "track"),
  suggestion("create_arrangement", "song"),
  suggestion("add_variation", "track"),
  suggestion("build_transition", "section"),
  suggestion("balance_section", "song"),
];

const ids = (list: readonly Suggestion[]) => list.map((s) => s.id);

describe("the suggestion chips' order", () => {
  it("puts the chip's own scope first, then what the view is for", () => {
    expect(ids(rankSuggestions(ALL, "mixer", "song"))).toEqual([
      "balance_section",
      "create_arrangement",
      "fill_empty_track",
    ]);
    expect(ids(rankSuggestions(ALL, "arrangement", "section"))).toEqual([
      "build_transition",
      "create_arrangement",
      "add_variation",
    ]);
    expect(ids(rankSuggestions(ALL, "sequence", "track"))).toEqual([
      "fill_empty_track",
      "add_variation",
      "create_arrangement",
    ]);
  });

  it("shows a few at most, and nothing when there is nothing to suggest", () => {
    expect(rankSuggestions(ALL, "library", "clip")).toHaveLength(MAX_SHOWN);
    expect(rankSuggestions([], "library", "clip")).toEqual([]);
  });
});

describe("the chips for what is on screen (GRV-26)", () => {
  const project = createSliceFixtureProject();
  const track = project.song.tracks[0] ?? null;
  const notes: ScopeSources = {
    selection: { kind: "notes", eventIds: ["evt_a" as EventId] },
    track,
  };
  const clips: ScopeSources = {
    selection: { kind: "clips", placementIds: ["plc_a" as PlacementId] },
    track,
  };
  const trackOnly: ScopeSources = { selection: null, track };

  it("offer a step for the selection, then one for the view and the track", () => {
    expect(ids(focusedSuggestions("sequence", resolveScope(notes, null)))).toEqual([
      "vary_notes",
      "write_fill",
    ]);
    expect(ids(focusedSuggestions("arrangement", resolveScope(clips, null)))).toEqual([
      "vary_clips",
      "develop_part",
    ]);
    expect(ids(focusedSuggestions("instrument", resolveScope(trackOnly, null)))).toEqual([
      "shape_sound",
    ]);
    expect(
      focusedSuggestions("library", resolveScope(trackOnly, null)).map((s) => s.label),
    ).toEqual(["Find a sound for BD"]);
  });

  it("drop the track's step when the chip is widened to the song", () => {
    const song = resolveScope(trackOnly, "song");
    expect(ids(focusedSuggestions("instrument", song))).toEqual([]);
    expect(focusedSuggestions("mixer", song).map((s) => s.label)).toEqual([
      "Balance the mix",
    ]);
  });

  it("come before the analysis's, with no repeats and a few at most", () => {
    const shown = assistantSuggestions(project, "arrangement", resolveScope(clips, null));
    expect(ids(shown).slice(0, 2)).toEqual(["vary_clips", "develop_part"]);
    expect(new Set(ids(shown)).size).toBe(shown.length);
    expect(shown.length).toBeLessThanOrEqual(MAX_SHOWN);
  });
});
