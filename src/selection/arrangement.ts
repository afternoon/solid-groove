import type { Placement, Project } from "../domain/entities";
import type { PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";

/**
 * The arrangement's one selection (`ARR-006`, #292).
 *
 * One value replaces the shell's bar range and the placement editor's ID set.
 * It is always exactly one of two shapes:
 *
 * - `point`: an insertion point on one track, which a click in empty space
 *   sets at the start of the bar clicked in. It selects no clip. A paste lands
 *   there.
 * - `clips`: whole clips. A click on a clip selects it, and a drag in empty
 *   space selects every clip its band contains or overlaps.
 *
 * The band a drag draws (`ArrangementBand`) is *not* a selection: on release
 * it becomes the clips it touched, or nothing. There is no range selection,
 * and nothing is trimmed (the product owner's 2026-09-25 decision).
 *
 * UI-only state, like the rest of `src/selection`: never persisted.
 */
export type ArrangementSelection =
  | { readonly kind: "point"; readonly trackId: TrackId; readonly ticks: number }
  | { readonly kind: "clips"; readonly placementIds: readonly PlacementId[] };

/** A track and a position on it, as the pointer reports it. */
export interface ArrangementPosition {
  readonly trackId: TrackId;
  readonly ticks: number;
}

/**
 * The rectangle a drag in empty space sweeps, while it is in flight: every
 * track between the press and the pointer, and the time between them. Free,
 * not snapped.
 */
export interface ArrangementBand {
  /** In the song's track order, with no duplicates. Never empty. */
  readonly trackIds: readonly TrackId[];
  readonly startTicks: number;
  /** At or after `startTicks`. Exclusive. */
  readonly endTicks: number;
}

/** A stretch of time with an exclusive end. */
export interface TickSpan {
  readonly startTicks: number;
  readonly endTicks: number;
}

/** Ticks are integers and never negative, whatever the pointer said. */
function wholeTicks(ticks: number): number {
  return Number.isFinite(ticks) ? Math.max(0, Math.round(ticks)) : 0;
}

function placementEnd(placement: Placement): number {
  return placement.startTicks + placement.durationTicks;
}

/** An insertion point exactly at `position`, in whole ticks. */
export function pointSelection(position: ArrangementPosition): ArrangementSelection {
  return { kind: "point", trackId: position.trackId, ticks: wholeTicks(position.ticks) };
}

/**
 * The point a click in empty space sets: the start of the bar clicked in, so a
 * paste there lands on a bar line. A click anywhere in bar 3 is 3.1.1.
 */
export function barStartPoint(position: ArrangementPosition): ArrangementSelection {
  const ticks = wholeTicks(position.ticks);
  return pointSelection({
    trackId: position.trackId,
    ticks: Math.floor(ticks / TICKS_PER_BAR) * TICKS_PER_BAR,
  });
}

/** The given clips, in the order given, with duplicates dropped. Null for none. */
export function clipsSelection(
  placementIds: readonly PlacementId[],
): ArrangementSelection | null {
  const unique = [...new Set(placementIds)];
  return unique.length > 0 ? { kind: "clips", placementIds: unique } : null;
}

/** The band between two corners, in either order, over every track between
 * them. Null if either track is not in the project. */
export function bandBetween(
  project: Project,
  from: ArrangementPosition,
  to: ArrangementPosition,
): ArrangementBand | null {
  const order = project.song.tracks.map((track) => track.id);
  const fromRow = order.indexOf(from.trackId);
  const toRow = order.indexOf(to.trackId);
  if (fromRow < 0 || toRow < 0) return null;
  const a = wholeTicks(from.ticks);
  const b = wholeTicks(to.ticks);
  return {
    trackIds: order.slice(Math.min(fromRow, toRow), Math.max(fromRow, toRow) + 1),
    startTicks: Math.min(a, b),
    endTicks: Math.max(a, b),
  };
}

/**
 * The clips a band touches, in song order: every clip on its tracks that it
 * wholly contains or overlaps, even by a tick. A clip that only meets the
 * band's edge is not touched, and a zero-width band touches nothing.
 */
export function placementsTouchedBy(
  band: ArrangementBand,
  project: Project,
): PlacementId[] {
  if (band.endTicks <= band.startTicks) return [];
  const tracks = new Set(band.trackIds);
  return project.song.placements
    .filter(
      (p) =>
        tracks.has(p.trackId) &&
        p.startTicks < band.endTicks &&
        placementEnd(p) > band.startTicks,
    )
    .map((p) => p.id);
}

/** The clips selected, in song order. A point selects none. */
export function selectedPlacementIds(
  selection: ArrangementSelection | null,
  project: Project,
): PlacementId[] {
  if (selection?.kind !== "clips") return [];
  const wanted = new Set(selection.placementIds);
  return project.song.placements.filter((p) => wanted.has(p.id)).map((p) => p.id);
}

/**
 * The extent of the selected clips, from the first one's start to the last
 * one's end, which zoom to selection frames. Null for a point, which has no
 * extent, and when no selected clip is left.
 */
export function selectionSpan(
  selection: ArrangementSelection | null,
  project: Project,
): TickSpan | null {
  const ids = new Set(selectedPlacementIds(selection, project));
  const placements = project.song.placements.filter((p) => ids.has(p.id));
  if (placements.length === 0) return null;
  return {
    startTicks: Math.min(...placements.map((p) => p.startTicks)),
    endTicks: Math.max(...placements.map(placementEnd)),
  };
}

/** Where a paste lands: the point, or the earliest selected clip's start. Null
 * when nothing is selected, so the caller falls back to the playhead. */
export function selectionStartTicks(
  selection: ArrangementSelection | null,
  project: Project,
): number | null {
  if (selection?.kind === "point") return selection.ticks;
  return selectionSpan(selection, project)?.startTicks ?? null;
}

/**
 * Drops what the project no longer contains, after an undo, a remote edit or a
 * delete: a clip that is gone, or the track a point was on. Returns null when
 * nothing is left, and the same reference when nothing changed.
 */
export function reconcileArrangementSelection(
  selection: ArrangementSelection | null,
  project: Project,
): ArrangementSelection | null {
  if (!selection) return null;
  if (selection.kind === "point") {
    const live = project.song.tracks.some((track) => track.id === selection.trackId);
    return live ? selection : null;
  }
  const live = new Set(project.song.placements.map((p) => p.id));
  const kept = selection.placementIds.filter((id) => live.has(id));
  if (kept.length === selection.placementIds.length) return selection;
  return clipsSelection(kept);
}
