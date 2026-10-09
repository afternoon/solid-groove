import { describe, expect, it } from "vitest";
import type { Suggestion } from "../../projection/projectAnalysisProjection";
import { MAX_SHOWN, rankSuggestions } from "./assistantSuggestions";

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
