/**
 * The suggestion chips above the composer (GRV-26): #70's context-derived
 * next steps (`buildProjectAnalysis`'s `suggestions`), ordered to follow the
 * view on screen and the scope the chip says. Clicking one sends its label
 * as a message.
 *
 * A suggestion whose scope is the chip's own comes first, then one the view
 * is for (the arrangement for structure, the mixer for balance, the clip and
 * instrument views for parts), then the rest in the analysis's own order.
 * Only the first {@link MAX_SHOWN} are shown, so the row never scrolls far.
 */
import type { Project } from "../../domain/entities";
import {
  buildProjectAnalysis,
  type Suggestion,
  type SuggestionId,
} from "../../projection/projectAnalysisProjection";
import type { EditorViewName } from "../editorViews";
import type { CatalogScope } from "./assistantScope";

/** The most chips shown at once. */
export const MAX_SHOWN = 3;

/** The suggestions each view is for. */
const VIEW_AFFINITY: Readonly<Record<EditorViewName, readonly SuggestionId[]>> = {
  arrangement: ["create_arrangement", "build_transition", "add_variation", "add_track"],
  sequence: ["fill_empty_track", "add_variation"],
  instrument: ["fill_empty_track", "add_track"],
  library: ["add_track", "fill_empty_track"],
  mixer: ["balance_section"],
};

function fitOf(
  suggestion: Suggestion,
  view: EditorViewName,
  scope: CatalogScope,
): number {
  const scopeFit = suggestion.scope === scope ? 2 : 0;
  const viewFit = VIEW_AFFINITY[view].includes(suggestion.id) ? 1 : 0;
  return scopeFit + viewFit;
}

/** Orders `suggestions` for the view and scope, best first, and caps them. */
export function rankSuggestions(
  suggestions: readonly Suggestion[],
  view: EditorViewName,
  scope: CatalogScope,
): readonly Suggestion[] {
  return suggestions
    .map((suggestion, index) => ({
      suggestion,
      index,
      score: fitOf(suggestion, view, scope),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_SHOWN)
    .map(({ suggestion }) => suggestion);
}

/** The project's suggestions for the view and scope on screen. */
export function assistantSuggestions(
  project: Project,
  view: EditorViewName,
  scope: CatalogScope,
): readonly Suggestion[] {
  return rankSuggestions(buildProjectAnalysis(project).suggestions, view, scope);
}
