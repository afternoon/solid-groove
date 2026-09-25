import type { Project } from "../domain/entities";
import {
  createFactoryContext,
  createNoteClip,
  createPlacement,
  createTrack,
} from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory, type PlacementId, type TrackId } from "../domain/ids";
import { assertProject } from "../domain/parse";

export interface LaidOutPlacement {
  readonly startTicks: number;
  readonly durationTicks: number;
  readonly clipOffsetTicks?: number;
}

/** A valid project with one track per `layout` row (the first is the slice
 * fixture's "BD"), each placement on its track's one clip. IDs mirror `layout`. */
export function buildArrangementProject(
  layout: readonly (readonly LaidOutPlacement[])[],
): {
  readonly project: Project;
  readonly trackIds: readonly TrackId[];
  readonly placementIds: readonly (readonly PlacementId[])[];
} {
  const base = createSliceFixtureProject();
  const context = createFactoryContext({ ids: createSeededIdFactory("arrangement") });
  const [bd] = base.song.tracks;
  const [bdClip] = base.clips;
  const tracks = [bd];
  const clips = [bdClip];
  for (let index = 1; index < layout.length; index += 1) {
    const track = createTrack(context, { name: `Track ${index + 1}`, order: index });
    tracks.push(track);
    clips.push(createNoteClip(context, { trackId: track.id, name: `Clip ${index + 1}` }));
  }
  const placements = layout.map((row, index) =>
    row.map((entry) =>
      createPlacement(context, {
        clipId: clips[index].id,
        trackId: tracks[index].id,
        ...entry,
      }),
    ),
  );
  const project = assertProject({
    ...base,
    song: { ...base.song, tracks, placements: placements.flat() },
    clips,
  });
  return {
    project,
    trackIds: tracks.map((track) => track.id),
    placementIds: placements.map((row) => row.map((placement) => placement.id)),
  };
}
