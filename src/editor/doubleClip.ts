import type { RawCommandInput } from "../commands";
import { duplicateNotes, updateClip, updatePlacement } from "../commands";
import { MAX_CLIP_LENGTH_TICKS } from "../domain/clipLength";
import type { Clip, Placement, Project } from "../domain/entities";
import type { IdFactory } from "../domain/ids";
import { toTicks } from "../domain/time";

/**
 * Double (#647), as Ableton's Duplicate Loop: the clip becomes twice as long
 * and every note is copied into the new half, whatever is selected. The
 * clip's arrangement placements that showed its end stretch to match, so the
 * new half plays where the clip does.
 *
 * Three registered commands in one transaction, so it is one revision and one
 * undo step: the clip grows first, then the copies land inside it, then the
 * placements stretch over it.
 */

/** Whether the clip can double without passing the longest clip length. */
export function canDouble(clip: Clip): boolean {
  return clip.lengthTicks * 2 <= MAX_CLIP_LENGTH_TICKS;
}

/** The commands that double `clip`; the caller checks `canDouble` first. */
export function doubleClip(
  project: Project,
  clip: Clip,
  ids: IdFactory,
): readonly RawCommandInput[] {
  const length = clip.lengthTicks;
  return [
    updateClip(clip.id, { lengthTicks: toTicks(length * 2) }),
    duplicateNotes(ids, project, {
      clipId: clip.id,
      eventIds: null,
      offsetTicks: length,
    }),
    ...stretchedPlacements(project, clip).map(({ id, durationTicks }) =>
      updatePlacement(id, { durationTicks: toTicks(durationTicks) }),
    ),
  ] as readonly RawCommandInput[];
}

/**
 * The clip's placements that showed its end, each grown by the clip's old
 * length but never into the next placement on its track: a track's
 * placements never overlap. A looped placement already repeats the clip, and
 * one that stops short of the end shows only part of it, so both stay as
 * they are.
 */
export function stretchedPlacements(
  project: Project,
  clip: Clip,
): readonly { readonly id: Placement["id"]; readonly durationTicks: number }[] {
  const placements = project.song.placements;
  return placements.flatMap((placement) => {
    if (placement.clipId !== clip.id || placement.looped) return [];
    if (placement.clipOffsetTicks + placement.durationTicks < clip.lengthTicks) return [];
    const end = placement.startTicks + placement.durationTicks;
    const nextStart = Math.min(
      ...placements
        .filter((other) => other.trackId === placement.trackId && other.startTicks >= end)
        .map((other) => other.startTicks),
    );
    const grown = Math.min(end + clip.lengthTicks, nextStart) - placement.startTicks;
    return grown > placement.durationTicks
      ? [{ id: placement.id, durationTicks: grown }]
      : [];
  });
}
