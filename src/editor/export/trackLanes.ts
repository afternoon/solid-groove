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

/**
 * The bar numbers the ruler labels: 1, then every `every` bars, for each bar
 * that starts inside the song. The bar after the end has no lane under it.
 */
export function rulerBars(bars: number, every = 4): number[] {
  return Array.from(
    { length: Math.floor((Math.max(1, bars) - 1) / every) + 1 },
    (_, k) => k * every + 1,
  );
}

/** The least room, in pixels, between two ruler labels. */
export const MIN_LABEL_GAP_PX = 56;

/**
 * Bars between ruler labels: 1, 2, 4, 8, 16, ... the first step that keeps
 * labels at least `MIN_LABEL_GAP_PX` apart over a lane area `widthPx` wide, so
 * a short song is numbered bar by bar. Before the lanes are measured (width 0)
 * it is the editor arrangement ruler's 4.
 */
export function rulerStep(bars: number, widthPx: number): number {
  if (widthPx <= 0) return 4;
  let step = 1;
  while ((step / Math.max(1, bars)) * widthPx < MIN_LABEL_GAP_PX) step *= 2;
  return step;
}
