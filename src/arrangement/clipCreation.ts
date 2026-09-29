/**
 * Double-click an empty bar to create a clip there (#661).
 *
 * Pure, like `placementTile.ts`: the arrangement view asks for the commands
 * and dispatches them, one command and so one undo step. A new clip is an empty, one-bar note clip named after
 * its track, placed at the start of the clicked bar, or where the free part
 * of that bar begins. A track's placements never overlap (#290), so the clip
 * fills only the free part of the bar, and a full bar creates nothing. Audio
 * tracks hold loops, not notes, so they get nothing either.
 */

import { addClip } from "../commands/definitions/clips";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import {
  createNoteClip,
  createPlacement,
  type DomainFactoryContext,
} from "../domain/factories";
import type { PlacementId, TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";

export interface ClipCreation {
  readonly commands: readonly RawCommandInput[];
  /** The new placement, for the caller to select. */
  readonly placementId: PlacementId;
}

/** The commands that create a one-bar clip in the bar holding `tick`, or null. */
export function createClipAt(
  project: Project,
  context: DomainFactoryContext,
  trackId: TrackId,
  tick: number,
): ClipCreation | null {
  const track = project.song.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.type !== "instrument") return null;

  const barStart = Math.floor(Math.max(0, tick) / TICKS_PER_BAR) * TICKS_PER_BAR;
  const barEnd = barStart + TICKS_PER_BAR;
  const onTrack = project.song.placements.filter(
    (placement) => placement.trackId === trackId,
  );
  // Past whatever ends inside the bar, and short of whatever starts in it.
  const start = Math.max(
    barStart,
    ...onTrack
      .map((placement) => placement.startTicks + placement.durationTicks)
      .filter((end) => end > barStart && end <= tick),
  );
  const end = Math.min(
    barEnd,
    ...onTrack
      .map((placement) => placement.startTicks)
      .filter((placementStart) => placementStart > tick),
  );
  const covered = onTrack.some(
    (placement) =>
      placement.startTicks < end &&
      placement.startTicks + placement.durationTicks > start,
  );
  if (end <= start || covered) return null;

  const clip = createNoteClip(context, {
    trackId,
    name: track.name,
    lengthTicks: TICKS_PER_BAR,
  });
  const placement = createPlacement(context, {
    clipId: clip.id,
    trackId,
    startTicks: start,
    durationTicks: end - start,
  });
  return {
    commands: [addClip(clip, [placement])],
    placementId: placement.id,
  };
}
