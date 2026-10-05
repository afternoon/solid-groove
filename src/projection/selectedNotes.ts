import type { Clip, NoteEvent, Placement, Project } from "../domain/entities";
import type { SelectionScope, SelectionState } from "../selection/types";

/**
 * The raw note events the assistant may see: the current selection's, and
 * nothing else (ADR 0007 decisions 1 to 3).
 *
 * Sending the selection's notes is what lets the assistant edit notes at
 * all; scoping them to the selection keeps the exposure to the material the
 * producer is working on. What a selection covers:
 *
 * - a note: that note;
 * - a clip, or a placement of one: the clip's notes (an edit to a placed
 *   clip is an edit to the clip);
 * - a track: the notes of every clip on it;
 * - a bar range or a section: the notes that start inside that span of the
 *   arrangement, on the range's tracks (every track for a section, or for a
 *   range that names none), looped placements included;
 * - anything else (the project, a device, an automation point): no notes.
 *
 * Nothing selected means no notes at all, and `null`, so the assistant knows
 * it has none rather than seeing an empty part. Events are listed per clip,
 * at their clip-relative positions, because that is what an edit addresses.
 * A clip's name is free text the allowlist does not name, so it is left out.
 */

export interface AssistantNoteEvent {
  readonly id: string;
  readonly trigger: NoteEvent["trigger"];
  readonly startTicks: number;
  readonly durationTicks: number;
  readonly velocity: number;
  readonly probability: number | null;
}

export interface AssistantSelectedClip {
  readonly clipId: string;
  readonly trackId: string;
  readonly lengthTicks: number;
  readonly events: readonly AssistantNoteEvent[];
}

export interface AssistantSelectedNotes {
  readonly clips: readonly AssistantSelectedClip[];
  readonly noteCount: number;
  /**
   * Selected notes left out because the selection is larger than
   * {@link MAX_SELECTED_NOTES}. The assistant is told, so it never mistakes
   * part of a selection for the whole.
   */
  readonly omittedNoteCount: number;
}

/**
 * The most selected notes one turn carries, so a whole dense track selected
 * still fits the smaller model's window beside the conversation.
 */
export const MAX_SELECTED_NOTES = 2_000;

type Picked = Map<string, Set<string> | "all">;

function noteEvents(clip: Clip): readonly NoteEvent[] {
  return clip.content.kind === "notes" ? clip.content.events : [];
}

function pickAll(picked: Picked, clip: Clip | undefined): void {
  if (clip && clip.content.kind === "notes") picked.set(clip.id, "all");
}

function pickEvent(picked: Picked, clipId: string, eventId: string): void {
  const current = picked.get(clipId);
  if (current === "all") return;
  const events = current ?? new Set<string>();
  events.add(eventId);
  picked.set(clipId, events);
}

/**
 * Whether `event` starts inside `[from, to)` of the arrangement anywhere
 * `placement` plays it.
 */
function startsInSpan(
  event: NoteEvent,
  placement: Placement,
  clip: Clip,
  from: number,
  to: number,
): boolean {
  const relative = event.startTicks - placement.clipOffsetTicks;
  const period = clip.lengthTicks;
  let position = placement.looped ? ((relative % period) + period) % period : relative;
  if (position < 0) return false;
  while (position < placement.durationTicks) {
    const at = placement.startTicks + position;
    if (at >= to) return false;
    if (at >= from) return true;
    if (!placement.looped) return false;
    position += period;
  }
  return false;
}

function pickSpan(
  picked: Picked,
  project: Project,
  clips: ReadonlyMap<string, Clip>,
  from: number,
  to: number,
  trackIds: readonly string[],
): void {
  const tracks = new Set(trackIds);
  for (const placement of project.song.placements) {
    if (tracks.size > 0 && !tracks.has(placement.trackId)) continue;
    const end = placement.startTicks + placement.durationTicks;
    if (end <= from || placement.startTicks >= to) continue;
    const clip = clips.get(placement.clipId);
    if (!clip) continue;
    for (const event of noteEvents(clip)) {
      if (startsInSpan(event, placement, clip, from, to)) {
        pickEvent(picked, clip.id, event.id);
      }
    }
  }
}

function pickScope(
  picked: Picked,
  project: Project,
  clips: ReadonlyMap<string, Clip>,
  scope: SelectionScope,
): void {
  switch (scope.kind) {
    case "event":
      for (const clip of project.clips) {
        if (noteEvents(clip).some((event) => event.id === scope.id)) {
          pickEvent(picked, clip.id, scope.id);
        }
      }
      return;
    case "clip":
      pickAll(picked, clips.get(scope.id));
      return;
    case "placement": {
      const placement = project.song.placements.find((p) => p.id === scope.id);
      if (placement) pickAll(picked, clips.get(placement.clipId));
      return;
    }
    case "track":
      for (const clip of project.clips) {
        if (clip.trackId === scope.id) pickAll(picked, clip);
      }
      return;
    case "barRange":
      pickSpan(picked, project, clips, scope.startTicks, scope.endTicks, scope.trackIds);
      return;
    case "section": {
      const section = project.song.sections.find((s) => s.id === scope.id);
      if (section) {
        pickSpan(
          picked,
          project,
          clips,
          section.startTicks,
          section.startTicks + section.durationTicks,
          [],
        );
      }
      return;
    }
    default:
      return;
  }
}

function toAssistantEvent(event: NoteEvent): AssistantNoteEvent {
  return {
    id: event.id,
    trigger: event.trigger,
    startTicks: event.startTicks,
    durationTicks: event.durationTicks,
    velocity: event.velocity,
    probability: event.probability,
  };
}

function byPosition(a: NoteEvent, b: NoteEvent): number {
  return a.startTicks - b.startTicks || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The selection's note events, or `null` when it selects none. */
export function selectedNotes(
  project: Project,
  selection: SelectionState | undefined,
): AssistantSelectedNotes | null {
  if (!selection || selection.scopes.length === 0) return null;
  const clips = new Map(project.clips.map((clip) => [clip.id, clip]));
  const picked: Picked = new Map();
  for (const scope of selection.scopes) pickScope(picked, project, clips, scope);

  const trackOrder = new Map(project.song.tracks.map((track) => [track.id, track.order]));
  const ordered = project.clips
    .filter((clip) => picked.has(clip.id))
    .sort(
      (a, b) =>
        (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  let budget = MAX_SELECTED_NOTES;
  let omittedNoteCount = 0;
  const selected: AssistantSelectedClip[] = [];
  for (const clip of ordered) {
    const chosen = picked.get(clip.id);
    const events = noteEvents(clip)
      .filter((event) => chosen === "all" || chosen?.has(event.id))
      .sort(byPosition);
    if (events.length === 0) continue;
    const kept = events.slice(0, Math.max(0, budget));
    omittedNoteCount += events.length - kept.length;
    budget -= kept.length;
    if (kept.length === 0) continue;
    selected.push({
      clipId: clip.id,
      trackId: clip.trackId,
      lengthTicks: clip.lengthTicks,
      events: kept.map(toAssistantEvent),
    });
  }
  if (selected.length === 0 && omittedNoteCount === 0) return null;
  return {
    clips: selected,
    noteCount: MAX_SELECTED_NOTES - budget,
    omittedNoteCount,
  };
}
