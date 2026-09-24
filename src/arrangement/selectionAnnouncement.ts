/**
 * What the arrangement's `aria-live` mirror says about its one selection
 * (`ARR-006`, #292), so a screen-reader user hears every kind of selection
 * rather than canvas pixels alone.
 *
 * The wording is the product owner's, recorded on #292:
 *
 * - nothing: "No selection"
 * - a point: "Position 3.1.1"
 * - one clip: "Selected clip on BD, bar 1"
 * - several clips: "2 clips selected"
 * - a range covering no clip: "Selected BD, …" on one track, "Selected 2
 *   tracks, …" on several
 *
 * Every stretch of time is named by one rule. When both ends sit on bar lines
 * it is named by whole bars, counting the last bar it occupies: "bar 1", "bars
 * 1 to 3". Otherwise it is named by the bars.beats.sixteenths position of each
 * end, 1-based as a DAW counts them: "2.4.1 to 4.4.1".
 */

import type { Project } from "../domain/entities";
import { TICKS_PER_BAR, ticksToBarsBeatsSixteenths } from "../domain/time";
import {
  type ArrangementSelection,
  coveredPlacementIds,
  isPointSelection,
} from "../selection";

/** A position as bars.beats.sixteenths, 1-based: tick 0 is "1.1.1". */
export function formatPosition(ticks: number): string {
  const { bars, beats, sixteenths } = ticksToBarsBeatsSixteenths(
    Math.max(0, Math.round(ticks)),
  );
  return `${bars + 1}.${beats + 1}.${sixteenths + 1}`;
}

/** A stretch of time, by the one naming rule in this module's comment. */
export function describeSpan(startTicks: number, endTicks: number): string {
  const onBarLines =
    endTicks > startTicks &&
    startTicks % TICKS_PER_BAR === 0 &&
    endTicks % TICKS_PER_BAR === 0;
  if (!onBarLines) return `${formatPosition(startTicks)} to ${formatPosition(endTicks)}`;
  const first = startTicks / TICKS_PER_BAR + 1;
  const last = endTicks / TICKS_PER_BAR;
  return first === last ? `bar ${first}` : `bars ${first} to ${last}`;
}

/** The announcement for `selection` in `project`. */
export function describeArrangementSelection(
  selection: ArrangementSelection | null,
  project: Project,
): string {
  if (!selection) return "No selection";
  if (isPointSelection(selection) && selection.kind === "range") {
    return `Position ${formatPosition(selection.span.startTicks)}`;
  }
  const trackName = (id: string) =>
    project.song.tracks.find((track) => track.id === id)?.name ?? "track";
  const covered = coveredPlacementIds(selection, project);
  if (covered.length > 1) return `${covered.length} clips selected`;
  if (covered.length === 1) {
    const clip = project.song.placements.find((p) => p.id === covered[0]);
    if (clip) {
      const span = describeSpan(clip.startTicks, clip.startTicks + clip.durationTicks);
      return `Selected clip on ${trackName(clip.trackId)}, ${span}`;
    }
  }
  if (selection.kind === "clips") return "No selection";
  const { trackIds, startTicks, endTicks } = selection.span;
  const tracks =
    trackIds.length === 1 ? trackName(trackIds[0]) : `${trackIds.length} tracks`;
  return `Selected ${tracks}, ${describeSpan(startTicks, endTicks)}`;
}
