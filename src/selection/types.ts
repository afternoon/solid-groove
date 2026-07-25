import type {
	AutomationId,
	ClipId,
	DeviceId,
	EventId,
	PlacementId,
	ProjectId,
	SectionId,
	TrackId,
} from "../domain/ids";
import type { Ticks } from "../domain/time";

/**
 * Selection and focus state (PRD sections 9.2-9.3).
 *
 * Selection is UI-only state: it identifies canonical entities by their stable
 * schema-v1 ID (never by array position), but it is never itself part of
 * persisted song state, and building it never mutates the project it points
 * into. Renaming, scrolling, zooming, and switching selection are all changes
 * to this module's state, not to `Song` or `Project`.
 *
 * Every scope other than `barRange` names one canonical entity by ID. A
 * `barRange` names a span of musical time (and, optionally, the tracks it
 * spans) rather than a single entity, for marquee selection, loop-to-song
 * (ARR-03), and arrangement loop ranges.
 *
 * An automation point has no ID of its own in the schema-v1 domain model
 * (`automationPointSchema` is just `{ tick, value }`): points within one lane
 * are ordered by strictly increasing tick (a `parse.ts` invariant), so a
 * `(laneId, tick)` pair is already a stable, unique reference to one point.
 */
export type SelectionScope =
	| { readonly kind: "project"; readonly id: ProjectId }
	| { readonly kind: "track"; readonly id: TrackId }
	| { readonly kind: "clip"; readonly id: ClipId }
	| { readonly kind: "placement"; readonly id: PlacementId }
	| { readonly kind: "event"; readonly id: EventId }
	| { readonly kind: "section"; readonly id: SectionId }
	| { readonly kind: "device"; readonly id: DeviceId }
	| {
			readonly kind: "automationPoint";
			readonly laneId: AutomationId;
			readonly tick: Ticks;
	  }
	| {
			readonly kind: "barRange";
			readonly startTicks: Ticks;
			readonly endTicks: Ticks;
			/** Empty means the range applies across all tracks (e.g. a loop range). */
			readonly trackIds: readonly TrackId[];
	  };

export type SelectionScopeKind = SelectionScope["kind"];

/**
 * The full selection: an ordered, duplicate-free set of scopes plus the
 * focused scope among them. Focus is the anchor used for shift-extend,
 * keyboard navigation, and single-target property panels; it is always
 * either `null` (nothing selected) or reference-equal to one entry in
 * `scopes` produced by this module's own operations.
 */
export interface SelectionState {
	readonly scopes: readonly SelectionScope[];
	readonly focus: SelectionScope | null;
}
