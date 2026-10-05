import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildAssistantPayload } from "../assistant/payload";
import { buildSystemBlocks } from "../assistant/prompt";
import { assistantContextPayloadSchema } from "../assistant/protocol";
import type { Clip, NoteEvent, Project } from "../domain/entities";
import {
  createBlankProject,
  createFactoryContext,
  createNoteClip,
  createNoteEvent,
  createPlacement,
  createSection,
  createTrack,
} from "../domain/factories";
import { createReferenceProject } from "../domain/fixtures";
import { createSeededIdFactory, type TrackId } from "../domain/ids";
import { TICKS_PER_BAR, TICKS_PER_QUARTER, toTicks } from "../domain/time";
import type { SelectionScope, SelectionState } from "../selection/types";
import { MAX_SELECTED_NOTES, selectedNotes } from "./selectedNotes";

const BAR = TICKS_PER_BAR;
const BEAT = TICKS_PER_QUARTER;

function select(...scopes: SelectionScope[]): SelectionState {
  return { scopes, focus: scopes[0] ?? null };
}

function eventsOf(clip: Clip): readonly NoteEvent[] {
  return clip.content.kind === "notes" ? clip.content.events : [];
}

/**
 * Two tracks. Track A's one-bar clip has a note on each beat; it plays once
 * at bar 0, and again from bar 4, looped for two bars and starting a beat in.
 * Track B has its own clip at bar 0. A section covers bars 4 and 5.
 */
function fixture() {
  const context = createFactoryContext({
    ids: createSeededIdFactory("selected-notes"),
    now: 1,
  });
  const base = createBlankProject({ ownerId: "owner", ids: context.ids, now: 1 });
  const trackA = createTrack(context, { name: "Bass", order: 0 });
  const trackB = createTrack(context, { name: "Keys", order: 1 });
  const beats = [0, 1, 2, 3].map((beat) =>
    createNoteEvent(context, {
      startTicks: beat * BEAT,
      durationTicks: BEAT,
      pitch: 40 + beat,
    }),
  );
  const clipA = createNoteClip(context, {
    trackId: trackA.id,
    name: "Bass riff",
    events: beats,
  });
  const keys = [
    createNoteEvent(context, { startTicks: 0, durationTicks: BAR, pitch: 72 }),
  ];
  const clipB = createNoteClip(context, {
    trackId: trackB.id,
    name: "Chords",
    events: keys,
  });
  const once = createPlacement(context, {
    clipId: clipA.id,
    trackId: trackA.id,
    startTicks: 0,
    durationTicks: BAR,
  });
  const looped = createPlacement(context, {
    clipId: clipA.id,
    trackId: trackA.id,
    startTicks: 4 * BAR,
    durationTicks: 2 * BAR,
    clipOffsetTicks: BEAT,
    looped: true,
  });
  const keysPlaced = createPlacement(context, {
    clipId: clipB.id,
    trackId: trackB.id,
    startTicks: 0,
    durationTicks: BAR,
  });
  const section = createSection(context, {
    name: "Drop",
    startTicks: 4 * BAR,
    durationTicks: 2 * BAR,
  });
  const project: Project = {
    ...base,
    song: {
      ...base.song,
      tracks: [trackA, trackB],
      placements: [once, looped, keysPlaced],
      sections: [section],
    },
    clips: [clipA, clipB],
  };
  return { project, trackA, trackB, clipA, clipB, beats, keys, once, looped, section };
}

function ids(notes: ReturnType<typeof selectedNotes>): string[] {
  return (notes?.clips ?? []).flatMap((clip) => clip.events.map((event) => event.id));
}

describe("selectedNotes", () => {
  it("is null when nothing is selected", () => {
    const { project } = fixture();
    expect(selectedNotes(project, undefined)).toBeNull();
    expect(selectedNotes(project, select())).toBeNull();
  });

  it("is null for a selection that holds no notes", () => {
    const { project } = fixture();
    expect(
      selectedNotes(project, select({ kind: "project", id: project.metadata.id })),
    ).toBeNull();
  });

  it("carries a selected note, and only it", () => {
    const { project, beats, clipA, trackA } = fixture();
    const notes = selectedNotes(project, select({ kind: "event", id: beats[2].id }));
    expect(notes).toEqual({
      clips: [
        {
          clipId: clipA.id,
          trackId: trackA.id,
          lengthTicks: BAR,
          events: [
            {
              id: beats[2].id,
              trigger: { kind: "pitch", pitch: 42 },
              startTicks: 2 * BEAT,
              durationTicks: BEAT,
              velocity: beats[2].velocity,
              probability: null,
            },
          ],
        },
      ],
      noteCount: 1,
      omittedNoteCount: 0,
    });
  });

  it("carries a clip's notes for a clip or any placement of it", () => {
    const { project, clipA, beats, once, looped } = fixture();
    const all = beats.map((event) => event.id);
    expect(ids(selectedNotes(project, select({ kind: "clip", id: clipA.id })))).toEqual(
      all,
    );
    expect(
      ids(selectedNotes(project, select({ kind: "placement", id: once.id }))),
    ).toEqual(all);
    expect(
      ids(selectedNotes(project, select({ kind: "placement", id: looped.id }))),
    ).toEqual(all);
  });

  it("carries every note on a selected track, and none from another", () => {
    const { project, trackB, keys } = fixture();
    expect(ids(selectedNotes(project, select({ kind: "track", id: trackB.id })))).toEqual(
      keys.map((event) => event.id),
    );
  });

  it("carries the notes that start inside a bar range, on its tracks", () => {
    const { project, trackA, beats } = fixture();
    const firstHalf = select({
      kind: "barRange",
      startTicks: toTicks(0),
      endTicks: toTicks(2 * BEAT),
      trackIds: [trackA.id],
    });
    expect(ids(selectedNotes(project, firstHalf))).toEqual([beats[0].id, beats[1].id]);
  });

  it("follows a looped placement's offset and repeats", () => {
    const { project, trackA, beats } = fixture();
    // From bar 4 the clip plays from its second beat, so the first beat of
    // bar 4 (and of bar 5, the loop's second pass) is the clip's beat 2.
    for (const bar of [4, 5]) {
      const range = select({
        kind: "barRange",
        startTicks: toTicks(bar * BAR),
        endTicks: toTicks(bar * BAR + BEAT),
        trackIds: [trackA.id],
      });
      expect(ids(selectedNotes(project, range))).toEqual([beats[1].id]);
    }
  });

  it("reads a bar range that names no tracks as every track", () => {
    const { project, beats, keys } = fixture();
    const range = select({
      kind: "barRange",
      startTicks: toTicks(0),
      endTicks: toTicks(1),
      trackIds: [],
    });
    expect(ids(selectedNotes(project, range))).toEqual([beats[0].id, keys[0].id]);
  });

  it("carries a section's notes from every track, and nothing outside it", () => {
    const { project, section, beats, keys } = fixture();
    const notes = selectedNotes(project, select({ kind: "section", id: section.id }));
    // Bars 4 and 5 hold only the looped bass; the keys play at bar 0 only.
    expect(new Set(ids(notes))).toEqual(new Set(beats.map((event) => event.id)));
    expect(ids(notes)).not.toContain(keys[0].id);
  });

  it("never leaves out a note silently: an oversized selection says how many it dropped", () => {
    const context = createFactoryContext({ ids: createSeededIdFactory("dense"), now: 1 });
    const base = createBlankProject({ ownerId: "owner", ids: context.ids, now: 1 });
    const track = createTrack(context, { name: "Hats", order: 0 });
    const events = Array.from({ length: MAX_SELECTED_NOTES + 25 }, (_, i) =>
      createNoteEvent(context, { startTicks: i, durationTicks: 1, pitch: 60 }),
    );
    const clip = createNoteClip(context, {
      trackId: track.id,
      name: "Dense",
      lengthTicks: 64 * BAR,
      events,
    });
    const project: Project = {
      ...base,
      song: { ...base.song, tracks: [track] },
      clips: [clip],
    };
    const notes = selectedNotes(project, select({ kind: "track", id: track.id }));
    expect(notes?.noteCount).toBe(MAX_SELECTED_NOTES);
    expect(notes?.omittedNoteCount).toBe(25);
    expect(ids(notes)).toEqual(
      events.slice(0, MAX_SELECTED_NOTES).map((event) => event.id),
    );
  });
});

/**
 * Every arrangement position `placement` plays `event` at, worked out
 * independently of the module: each pass of the clip (any whole number of
 * clip lengths, for a looped placement) that lands inside the placement.
 */
function playedAt(project: Project, event: NoteEvent, clip: Clip): number[] {
  const positions: number[] = [];
  for (const placement of project.song.placements) {
    if (placement.clipId !== clip.id) continue;
    const relative = event.startTicks - placement.clipOffsetTicks;
    const passes = placement.looped
      ? Math.ceil((placement.durationTicks + Math.abs(relative)) / clip.lengthTicks) + 1
      : 0;
    for (let pass = -passes; pass <= passes; pass += 1) {
      const local = relative + pass * clip.lengthTicks;
      if (local >= 0 && local < placement.durationTicks) {
        positions.push(placement.startTicks + local);
      }
    }
  }
  return positions;
}

function describeNeverOutside(name: string, project: Project): void {
  const allEvents = project.clips.flatMap((clip) =>
    eventsOf(clip).map((event) => ({ clip, event })),
  );
  const starts = new Map(
    allEvents.map(({ clip, event }) => [event.id, playedAt(project, event, clip)]),
  );

  function inSpan(
    clip: Clip,
    event: NoteEvent,
    from: number,
    to: number,
    trackIds: readonly string[],
  ): boolean {
    if (trackIds.length > 0 && !trackIds.includes(clip.trackId)) return false;
    return (starts.get(event.id) ?? []).some((at) => at >= from && at < to);
  }

  /** What each scope selects, worked out independently of the module. */
  function expected(scopes: readonly SelectionScope[]): Set<string> {
    const chosen = new Set<string>();
    for (const scope of scopes) {
      for (const { clip, event } of allEvents) {
        const placements = project.song.placements.filter((p) => p.clipId === clip.id);
        const section =
          scope.kind === "section"
            ? project.song.sections.find((candidate) => candidate.id === scope.id)
            : undefined;
        if (
          (scope.kind === "event" && scope.id === event.id) ||
          (scope.kind === "clip" && scope.id === clip.id) ||
          (scope.kind === "track" && scope.id === clip.trackId) ||
          (scope.kind === "placement" && placements.some((p) => p.id === scope.id)) ||
          (scope.kind === "barRange" &&
            inSpan(clip, event, scope.startTicks, scope.endTicks, scope.trackIds)) ||
          (section !== undefined &&
            inSpan(
              clip,
              event,
              section.startTicks,
              section.startTicks + section.durationTicks,
              [],
            ))
        ) {
          chosen.add(event.id);
        }
      }
    }
    return chosen;
  }

  const songEnd = Math.max(
    BAR,
    ...project.song.placements.map((p) => p.startTicks + p.durationTicks),
  );
  const trackIds: TrackId[] = project.song.tracks.map((track) => track.id);
  // Edges on the sixteenth grid notes start on, so a range often begins or
  // ends exactly on a note: the half-open boundary is what gets exercised.
  const SIXTEENTH = BEAT / 4;
  const barRange = fc
    .record({
      start: fc.integer({ min: 0, max: Math.ceil(songEnd / SIXTEENTH) }),
      length: fc.integer({ min: 1, max: (4 * BAR) / SIXTEENTH }),
      tracks: fc.subarray(trackIds),
    })
    .map(({ start, length, tracks }) => ({
      kind: "barRange" as const,
      startTicks: toTicks(start * SIXTEENTH),
      endTicks: toTicks((start + length) * SIXTEENTH),
      trackIds: tracks,
    }));

  const scope = fc.oneof(
    fc.constantFrom(...allEvents.map(({ event }) => ({ kind: "event", id: event.id }))),
    fc.constantFrom(...project.clips.map((clip) => ({ kind: "clip", id: clip.id }))),
    fc.constantFrom(...trackIds.map((id) => ({ kind: "track", id }))),
    fc.constantFrom(
      ...project.song.placements.map((placement) => ({
        kind: "placement",
        id: placement.id,
      })),
    ),
    fc.constantFrom(
      ...project.song.sections.map((section) => ({ kind: "section", id: section.id })),
    ),
    barRange,
  ) as fc.Arbitrary<SelectionScope>;

  it(`${name}: for any mix of notes, clips, placements, tracks, bar ranges and sections`, () => {
    fc.assert(
      fc.property(fc.array(scope, { maxLength: 6 }), (scopes) => {
        const selection = select(...scopes);
        const notes = selectedNotes(project, selection);
        const want = expected(scopes);
        if (want.size <= MAX_SELECTED_NOTES) {
          expect(new Set(ids(notes))).toEqual(want);
        }
        for (const id of ids(notes)) expect(want.has(id)).toBe(true);
        if (want.size === 0) expect(notes).toBeNull();

        // What actually reaches the provider: the system blocks, serialized.
        const payload = buildAssistantPayload(project, selection);
        expect(assistantContextPayloadSchema.safeParse(payload).success).toBe(true);
        const sent = JSON.stringify(buildSystemBlocks(payload));
        for (const { event } of allEvents) {
          if (!want.has(event.id)) expect(sent).not.toContain(event.id);
        }
      }),
      { numRuns: 200 },
    );
  }, 60_000);
}

describe("selectedNotes never includes a note outside the selection", () => {
  describeNeverOutside("the reference project", createReferenceProject());
  // Small, but with a looped placement that starts a beat into its clip.
  describeNeverOutside("a looped, offset placement", fixture().project);
});
