import type { Placement, Project } from "../domain/entities";
import type { PlacementId, TrackId } from "../domain/ids";

/**
 * The arrangement's one selection (`ARR-006`, #292).
 *
 * One value replaces the shell's bar range and the placement editor's ID set.
 * Ableton's model: a stretch of time on one or more tracks, selecting every
 * clip it touches. Exactly one of two shapes is held at a time:
 *
 * - `range`: a free, unsnapped span dragged over empty space. Zero length is a
 *   *point*, the cursor a bare click sets. What it covers is read from the live
 *   project, never stored.
 * - `clips`: clicked clips, or ones an operation made. Their span is derived,
 *   so it follows a clip that is moved or resized.
 *
 * UI-only state, like the rest of `src/selection`: never persisted.
 */

/** A span of musical time on one or more tracks. Zero length is a point. */
export interface ArrangementSpan {
  /** In the song's track order, with no duplicates. Never empty. */
  readonly trackIds: readonly TrackId[];
  readonly startTicks: number;
  /** At or after `startTicks`. Exclusive: the span ends where this begins. */
  readonly endTicks: number;
}

export type ArrangementSelection =
  | { readonly kind: "range"; readonly span: ArrangementSpan }
  | { readonly kind: "clips"; readonly placementIds: readonly PlacementId[] };

/** One corner of a range: a track and a position on it. */
export interface ArrangementPosition {
  readonly trackId: TrackId;
  readonly ticks: number;
}

/** Ticks are integers and never negative, whatever the pointer said. */
function wholeTicks(ticks: number): number {
  return Number.isFinite(ticks) ? Math.max(0, Math.round(ticks)) : 0;
}

/** A zero-length range: the cursor a click in empty space sets. */
export function pointSelection(position: ArrangementPosition): ArrangementSelection {
  const ticks = wholeTicks(position.ticks);
  return {
    kind: "range",
    span: { trackIds: [position.trackId], startTicks: ticks, endTicks: ticks },
  };
}

/** The range between two corners, in either order, over every track between
 * them. Null if either track is not in the project. */
export function rangeSelection(
  project: Project,
  from: ArrangementPosition,
  to: ArrangementPosition,
): ArrangementSelection | null {
  const order = project.song.tracks.map((track) => track.id);
  const fromRow = order.indexOf(from.trackId);
  const toRow = order.indexOf(to.trackId);
  if (fromRow < 0 || toRow < 0) return null;
  const a = wholeTicks(from.ticks);
  const b = wholeTicks(to.ticks);
  return {
    kind: "range",
    span: {
      trackIds: order.slice(Math.min(fromRow, toRow), Math.max(fromRow, toRow) + 1),
      startTicks: Math.min(a, b),
      endTicks: Math.max(a, b),
    },
  };
}

/** The given clips, in the order given, with duplicates dropped. */
export function clipsSelection(
  placementIds: readonly PlacementId[],
): ArrangementSelection | null {
  const unique = [...new Set(placementIds)];
  return unique.length > 0 ? { kind: "clips", placementIds: unique } : null;
}

/** True for a zero-length range: a position rather than a stretch of time. */
export function isPointSelection(selection: ArrangementSelection | null): boolean {
  return (
    selection?.kind === "range" && selection.span.endTicks === selection.span.startTicks
  );
}

function placementEnd(placement: Placement): number {
  return placement.startTicks + placement.durationTicks;
}

/** The clips selected, in song order. A range selects every clip it overlaps,
 * even partly, but not one that only touches its edge. A point selects none. */
export function coveredPlacementIds(
  selection: ArrangementSelection | null,
  project: Project,
): PlacementId[] {
  if (!selection) return [];
  if (selection.kind === "clips") {
    const wanted = new Set(selection.placementIds);
    return project.song.placements.filter((p) => wanted.has(p.id)).map((p) => p.id);
  }
  const { trackIds, startTicks, endTicks } = selection.span;
  if (endTicks <= startTicks) return [];
  const tracks = new Set(trackIds);
  return project.song.placements
    .filter(
      (p) =>
        tracks.has(p.trackId) && p.startTicks < endTicks && placementEnd(p) > startTicks,
    )
    .map((p) => p.id);
}

/** The time the selection stands for: the range itself, or the earliest start
 * to latest end of its clips, on their tracks. Null when nothing is live. */
export function selectionSpan(
  selection: ArrangementSelection | null,
  project: Project,
): ArrangementSpan | null {
  if (!selection) return null;
  if (selection.kind === "range") return selection.span;
  const ids = new Set(selection.placementIds);
  const placements = project.song.placements.filter((p) => ids.has(p.id));
  if (placements.length === 0) return null;
  const tracks = new Set(placements.map((p) => p.trackId));
  return {
    trackIds: project.song.tracks.map((t) => t.id).filter((id) => tracks.has(id)),
    startTicks: Math.min(...placements.map((p) => p.startTicks)),
    endTicks: Math.max(...placements.map(placementEnd)),
  };
}

/**
 * Drops what the project no longer contains, after an undo, a remote edit or a
 * delete: a clip that is gone, or a track a range ran across. Returns null when
 * nothing is left, and the same reference when nothing changed.
 */
export function reconcileArrangementSelection(
  selection: ArrangementSelection | null,
  project: Project,
): ArrangementSelection | null {
  if (!selection) return null;
  if (selection.kind === "clips") {
    const live = new Set(project.song.placements.map((p) => p.id));
    const kept = selection.placementIds.filter((id) => live.has(id));
    if (kept.length === selection.placementIds.length) return selection;
    return clipsSelection(kept);
  }
  const live = new Set(project.song.tracks.map((t) => t.id));
  const kept = selection.span.trackIds.filter((id) => live.has(id));
  if (kept.length === selection.span.trackIds.length) return selection;
  if (kept.length === 0) return null;
  return { kind: "range", span: { ...selection.span, trackIds: kept } };
}
