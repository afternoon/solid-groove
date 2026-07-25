/**
 * Read-only consumer projections (PRD sections 9.2-9.3, 9.7-9.8).
 *
 * Every projection here is a pure function of a `Project` (and, for the
 * assistant context, the current `SelectionState`): none of them can mutate
 * canonical state, and none of them read Firebase, Tone.js, or SolidJS types.
 * Passing a projection's own previous build back in lets it reuse entries
 * whose relevant fields have not changed, so an edit to one entity does not
 * look like a change to every other entity a consumer is holding onto.
 */

export * from "./arrangementProjection";
export * from "./assistantContextProjection";
export * from "./audioProjection";
export * from "./fingerprint";
export * from "./projectSummaryProjection";
