import type { Project } from "../../domain/entities";
import { TICKS_PER_BAR } from "../../domain/time";

/**
 * What the Export dialog's mini-arrangement draws for each row (EXP-004): a
 * track's clips as spans on the song's bar grid, tracks in arrangement order
 * and then the returns. A pure read of the project, so the dialog and its
 * tests share one derivation and the canvas never walks domain-shaped data.
 */

/** One placed clip, in bars from the start of the song (fractions allowed). */
export interface LaneSpan {
  readonly startBar: number;
  readonly lengthBars: number;
}

export interface TrackLaneRow {
  readonly id: string;
  readonly name: string;
  /** The track's own colour, `#rrggbb`; a return has none. */
  readonly color: string | null;
  readonly muted: boolean;
  /** A return is always part of the export, so its row is read-only. */
  readonly fixed: boolean;
  readonly lanes: readonly LaneSpan[];
}

/** A row as the list draws it: the project's facts plus the selection's. */
export interface TrackLaneView extends TrackLaneRow {
  readonly included: boolean;
  readonly picked: boolean;
}

export function deriveTrackLaneRows(project: Project): TrackLaneRow[] {
  const { tracks, returns, placements } = project.song;
  const spans = new Map<string, LaneSpan[]>();
  for (const placement of placements) {
    const list = spans.get(placement.trackId) ?? [];
    list.push({
      startBar: placement.startTicks / TICKS_PER_BAR,
      lengthBars: placement.durationTicks / TICKS_PER_BAR,
    });
    spans.set(placement.trackId, list);
  }
  const trackRows = [...tracks]
    .sort((a, b) => a.order - b.order)
    .map((track) => ({
      id: track.id,
      name: track.name,
      color: track.color,
      muted: track.mixer.muted,
      fixed: false,
      lanes: (spans.get(track.id) ?? []).sort((a, b) => a.startBar - b.startBar),
    }));
  const returnRows = [...returns]
    .sort((a, b) => a.order - b.order)
    .map((bus) => ({
      id: bus.id,
      name: bus.name,
      color: null,
      muted: bus.mixer.muted,
      fixed: true,
      lanes: [],
    }));
  return [...trackRows, ...returnRows];
}

/** The song's length in whole bars: where its last clip ends, at least one. */
export function songLengthBars(rows: readonly TrackLaneRow[]): number {
  let end = 0;
  for (const row of rows) {
    for (const span of row.lanes) end = Math.max(end, span.startBar + span.lengthBars);
  }
  return Math.max(1, Math.ceil(end));
}

/** The bar numbers the ruler labels: 1, then every 16 bars. */
export function rulerBars(bars: number, every = 16): number[] {
  return Array.from({ length: Math.floor(bars / every) + 1 }, (_, k) => k * every + 1);
}
