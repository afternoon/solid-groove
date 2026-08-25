import type {
  Clip,
  NoteEvent,
  Placement,
  Project,
  Song,
  Track,
} from "../domain/entities";
import type { ClipId, EventId, PlacementId, TrackId } from "../domain/ids";

/**
 * Immutable edit helpers shared by command definitions.
 *
 * Every helper returns new objects along the path it changed and reuses every
 * untouched object, so a note edit on a 50-track project leaves 49 track
 * objects referentially identical. That structural sharing is what lets
 * `FND-005` projections and the audio engine tell "this changed" from "this
 * did not" by identity instead of deep comparison, and it is why history keeps
 * commands rather than deep project copies.
 */

export function findTrack(project: Project, trackId: TrackId): Track | undefined {
  return project.song.tracks.find((track) => track.id === trackId);
}

export function findClip(project: Project, clipId: ClipId): Clip | undefined {
  return project.clips.find((clip) => clip.id === clipId);
}

export function findPlacement(
  project: Project,
  placementId: PlacementId,
): Placement | undefined {
  return project.song.placements.find((placement) => placement.id === placementId);
}

export function findNoteEvent(clip: Clip, eventId: EventId): NoteEvent | undefined {
  return clip.content.kind === "notes"
    ? clip.content.events.find((event) => event.id === eventId)
    : undefined;
}

/** The clip's note events, or `undefined` when the clip is not note content. */
export function noteEventsOf(clip: Clip): readonly NoteEvent[] | undefined {
  return clip.content.kind === "notes" ? clip.content.events : undefined;
}

export function withSong(project: Project, song: Song): Project {
  return { ...project, song };
}

export function withClips(project: Project, clips: readonly Clip[]): Project {
  return { ...project, clips: [...clips] };
}

/** Replaces one clip by ID, leaving every other clip object untouched. */
export function replaceClip(project: Project, next: Clip): Project {
  return withClips(
    project,
    project.clips.map((clip) => (clip.id === next.id ? next : clip)),
  );
}

export function withNoteEvents(clip: Clip, events: readonly NoteEvent[]): Clip {
  return { ...clip, content: { kind: "notes", events: [...events] } };
}

export function replaceTrack(project: Project, next: Track): Project {
  return withSong(project, {
    ...project.song,
    tracks: project.song.tracks.map((track) => (track.id === next.id ? next : track)),
  });
}

export function replacePlacement(project: Project, next: Placement): Project {
  return withSong(project, {
    ...project.song,
    placements: project.song.placements.map((placement) =>
      placement.id === next.id ? next : placement,
    ),
  });
}

/** Rewrites `order` to 0..n-1 in array order, satisfying the ordering invariant. */
export function renumber<T extends { order: number }>(items: readonly T[]): T[] {
  return items.map((item, index) =>
    item.order === index ? item : { ...item, order: index },
  );
}

/** Sorts a copy by `order` without mutating the input array. */
export function byOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/**
 * Resolves a selection of note events: an explicit ID list, or every event in
 * the clip when the payload asks for "all". Returns the missing IDs so a
 * command can reject a stale selection instead of silently editing fewer notes
 * than the user selected.
 */
export function selectEvents(
  clip: Clip,
  eventIds: readonly EventId[] | null,
): { selected: NoteEvent[]; missing: EventId[] } {
  const events = noteEventsOf(clip) ?? [];
  if (eventIds === null) {
    return { selected: sortEvents(events), missing: [] };
  }
  const byId = new Map(events.map((event) => [event.id, event]));
  const selected: NoteEvent[] = [];
  const missing: EventId[] = [];
  for (const eventId of eventIds) {
    const event = byId.get(eventId);
    if (event) {
      selected.push(event);
    } else {
      missing.push(eventId);
    }
  }
  return { selected: sortEvents(selected), missing };
}

/**
 * Deterministic event order: start tick, then ID. Transformations iterate in
 * this order so their result never depends on the order a UI happened to
 * collect a selection in.
 */
export function sortEvents(events: readonly NoteEvent[]): NoteEvent[] {
  return [...events].sort(
    (a, b) => a.startTicks - b.startTicks || compareIds(a.id, b.id),
  );
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Applies `changes` to the listed events, leaving the rest identical. */
export function mapEvents(clip: Clip, changed: ReadonlyMap<EventId, NoteEvent>): Clip {
  const events = noteEventsOf(clip) ?? [];
  return withNoteEvents(
    clip,
    events.map((event) => changed.get(event.id) ?? event),
  );
}

export function pluralize(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

/** Quotes a user-authored name for a summary line. */
export function quoted(name: string): string {
  return `"${name}"`;
}

/** A clip's name for a summary line, falling back to its ID once deleted. */
export function clipLabel(project: Project, clipId: ClipId): string {
  return quoted(findClip(project, clipId)?.name ?? clipId);
}

/** A track's name for a summary line, falling back to its ID once deleted. */
export function trackLabel(project: Project, trackId: TrackId): string {
  return quoted(findTrack(project, trackId)?.name ?? trackId);
}
