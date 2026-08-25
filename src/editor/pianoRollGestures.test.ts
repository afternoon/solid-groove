import { describe, expect, it } from "vitest";
import type { Clip, NoteEvent } from "../domain/entities";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import type { EventId } from "../domain/ids";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";
import { MAX_PITCH, MIN_PITCH, type PianoRollViewport } from "./pianoRollGeometry";
import {
  clampPitch,
  clampStart,
  marqueeRect,
  moveUpdates,
  noteEvents,
  notesInRect,
  pitchDeltaOf,
  pitchOf,
  resizeUpdates,
  selectAll,
  selectOnly,
  tickDeltaOf,
  toggleSelected,
} from "./pianoRollGestures";

/** The roll's own default scale, so these assertions read in real pixels. */
const VIEWPORT: PianoRollViewport = {
  pixelsPerTick: 0.25,
  rowHeight: 14,
  scrollTicks: 0,
  scrollTop: 0,
  topPitch: 96,
};

const CLIP_LENGTH = TICKS_PER_BAR * 2;

function fixtureClip(): Clip {
  return createPianoRollFixtureProject().clips[0];
}

/** A minimal pitched note; only the fields the gesture maths reads. */
function note(
  id: string,
  startTicks: number,
  durationTicks: number,
  pitch: number,
): NoteEvent {
  return {
    id: id as EventId,
    startTicks,
    durationTicks,
    velocity: 0.8,
    trigger: { kind: "pitch", pitch },
  } as NoteEvent;
}

describe("pianoRollGestures", () => {
  describe("noteEvents / pitchOf", () => {
    it("reads a note clip's events and their pitches", () => {
      const clip = fixtureClip();
      const events = noteEvents(clip);
      expect(events).toHaveLength(4);
      expect(events.map(pitchOf)).toEqual([60, 64, 67, 72]);
    });

    it("reads no events from non-note clip content", () => {
      const clip = {
        ...fixtureClip(),
        content: { kind: "audio" },
      } as unknown as Clip;
      expect(noteEvents(clip)).toEqual([]);
    });

    it("falls back to middle C for a non-pitched trigger", () => {
      const pad = {
        id: "evt_pad" as EventId,
        startTicks: 0,
        durationTicks: TICKS_PER_SIXTEENTH,
        velocity: 1,
        trigger: { kind: "pad", padId: "pad_1" },
      } as unknown as NoteEvent;
      expect(pitchOf(pad)).toBe(60);
    });
  });

  describe("clampPitch", () => {
    it("clamps to the displayable MIDI range and passes anything inside through", () => {
      expect(clampPitch(-5)).toBe(MIN_PITCH);
      expect(clampPitch(500)).toBe(MAX_PITCH);
      expect(clampPitch(60)).toBe(60);
    });
  });

  describe("clampStart", () => {
    it("never returns a negative start", () => {
      expect(clampStart(-100, TICKS_PER_SIXTEENTH, CLIP_LENGTH)).toBe(0);
    });

    it("keeps the note's tail inside the clip", () => {
      expect(clampStart(CLIP_LENGTH, TICKS_PER_SIXTEENTH, CLIP_LENGTH)).toBe(
        CLIP_LENGTH - TICKS_PER_SIXTEENTH,
      );
    });

    it("pins a note longer than the clip to tick 0 rather than going negative", () => {
      expect(clampStart(50, CLIP_LENGTH * 2, CLIP_LENGTH)).toBe(0);
    });
  });

  describe("moveUpdates", () => {
    it("snaps the shifted start to the 16th grid and moves the pitch by whole rows", () => {
      const original = note("evt_a", TICKS_PER_SIXTEENTH * 4, 48, 60);
      const [update] = moveUpdates([original], TICKS_PER_SIXTEENTH + 5, 2, CLIP_LENGTH);
      expect(update.eventId).toBe(original.id);
      expect(update.changes.startTicks).toBe(TICKS_PER_SIXTEENTH * 5);
      expect(update.changes.trigger).toEqual({ kind: "pitch", pitch: 62 });
    });

    it("clamps each note independently at the clip's boundaries", () => {
      const early = note("evt_a", 0, TICKS_PER_SIXTEENTH, 60);
      const late = note(
        "evt_b",
        CLIP_LENGTH - TICKS_PER_SIXTEENTH,
        TICKS_PER_SIXTEENTH,
        62,
      );
      const dragLeft = moveUpdates([early, late], -CLIP_LENGTH, 0, CLIP_LENGTH);
      expect(dragLeft[0].changes.startTicks).toBe(0);
      expect(dragLeft[1].changes.startTicks).toBe(0);

      const dragRight = moveUpdates([early, late], CLIP_LENGTH, 0, CLIP_LENGTH);
      expect(dragRight[0].changes.startTicks).toBe(CLIP_LENGTH - TICKS_PER_SIXTEENTH);
      expect(dragRight[1].changes.startTicks).toBe(CLIP_LENGTH - TICKS_PER_SIXTEENTH);
    });

    it("clamps a pitch driven past the MIDI range", () => {
      const high = note("evt_a", 0, TICKS_PER_SIXTEENTH, 120);
      const low = note("evt_b", 0, TICKS_PER_SIXTEENTH, 3);
      expect(moveUpdates([high], 0, 50, CLIP_LENGTH)[0].changes.trigger).toEqual({
        kind: "pitch",
        pitch: MAX_PITCH,
      });
      expect(moveUpdates([low], 0, -50, CLIP_LENGTH)[0].changes.trigger).toEqual({
        kind: "pitch",
        pitch: MIN_PITCH,
      });
    });

    it("returns one update per dragged note, preserving order", () => {
      const originals = noteEvents(fixtureClip());
      const updates = moveUpdates(originals, 0, 0, CLIP_LENGTH);
      expect(updates.map((update) => update.eventId)).toEqual(originals.map((n) => n.id));
    });
  });

  describe("resizeUpdates", () => {
    it("snaps the new duration to the 16th grid", () => {
      const original = note("evt_a", 0, TICKS_PER_SIXTEENTH, 60);
      const [update] = resizeUpdates(
        [original],
        TICKS_PER_SIXTEENTH * 2 + 3,
        CLIP_LENGTH,
      );
      expect(update.changes.durationTicks).toBe(TICKS_PER_SIXTEENTH * 3);
    });

    it("never shrinks a note below one 16th", () => {
      const original = note("evt_a", 0, TICKS_PER_SIXTEENTH, 60);
      const [update] = resizeUpdates([original], -CLIP_LENGTH, CLIP_LENGTH);
      expect(update.changes.durationTicks).toBe(TICKS_PER_SIXTEENTH);
    });

    it("never grows a note past the clip's end", () => {
      const original = note(
        "evt_a",
        CLIP_LENGTH - TICKS_PER_SIXTEENTH * 2,
        TICKS_PER_SIXTEENTH,
        60,
      );
      const [update] = resizeUpdates([original], CLIP_LENGTH, CLIP_LENGTH);
      expect(update.changes.durationTicks).toBe(TICKS_PER_SIXTEENTH * 2);
      expect(
        original.startTicks + (update.changes.durationTicks ?? 0),
      ).toBeLessThanOrEqual(CLIP_LENGTH);
    });
  });

  describe("pitchDeltaOf / tickDeltaOf", () => {
    it("raises the pitch when the pointer moves up, and rounds to whole rows", () => {
      expect(pitchDeltaOf(100, 100 - 14 * 3, 14)).toBe(3);
      expect(pitchDeltaOf(100, 100 + 14 * 2, 14)).toBe(-2);
      // Just over half a row rounds to a whole row.
      expect(pitchDeltaOf(100, 100 - 8, 14)).toBe(1);
      expect(pitchDeltaOf(100, 100 - 6, 14)).toBe(0);
    });

    it("converts pointer travel to ticks at the viewport's scale", () => {
      expect(tickDeltaOf(0, 48, 0.25)).toBe(192);
      expect(tickDeltaOf(48, 0, 0.25)).toBe(-192);
    });
  });

  describe("selection algebra", () => {
    it("selectOnly yields exactly that one id", () => {
      expect([...selectOnly("evt_a" as EventId)]).toEqual(["evt_a"]);
    });

    it("toggleSelected adds an absent id and removes a present one, without mutating the input", () => {
      const current: ReadonlySet<EventId> = new Set(["evt_a"] as EventId[]);
      const added = toggleSelected(current, "evt_b" as EventId);
      expect([...added].sort()).toEqual(["evt_a", "evt_b"]);
      expect([...current]).toEqual(["evt_a"]);

      const removed = toggleSelected(added, "evt_a" as EventId);
      expect([...removed]).toEqual(["evt_b"]);
    });

    it("selectAll yields every note in the clip", () => {
      const clip = fixtureClip();
      expect([...selectAll(clip)].sort()).toEqual(
        noteEvents(clip)
          .map((n) => n.id as string)
          .sort(),
      );
    });
  });

  describe("marqueeRect", () => {
    it("normalizes a drag in any direction to the same rectangle", () => {
      const downRight = marqueeRect(10, 20, 50, 80);
      const upLeft = marqueeRect(50, 80, 10, 20);
      expect(downRight).toEqual({
        left: 10,
        right: 50,
        top: 20,
        bottom: 80,
      });
      expect(upLeft).toEqual(downRight);
    });
  });

  describe("notesInRect", () => {
    it("sweeps only the notes the rectangle actually covers", () => {
      const clip = fixtureClip();
      const events = noteEvents(clip);
      const first = events[0]; // pitch 60, tick 0
      // A band over pitch 60's row only, spanning the first 16th.
      const rowTop = (VIEWPORT.topPitch - 60) * VIEWPORT.rowHeight;
      const swept = notesInRect(clip, VIEWPORT, {
        left: 0,
        right: TICKS_PER_SIXTEENTH * VIEWPORT.pixelsPerTick,
        top: rowTop + 1,
        bottom: rowTop + VIEWPORT.rowHeight - 1,
      });
      expect([...swept]).toEqual([first.id]);
    });

    it("sweeps every note when the rectangle covers the whole clip", () => {
      const clip = fixtureClip();
      const swept = notesInRect(clip, VIEWPORT, {
        left: 0,
        right: CLIP_LENGTH * VIEWPORT.pixelsPerTick,
        top: 0,
        bottom: 128 * VIEWPORT.rowHeight,
      });
      expect(swept.size).toBe(noteEvents(clip).length);
    });

    it("sweeps nothing for an empty rectangle away from every note", () => {
      const clip = fixtureClip();
      const swept = notesInRect(clip, VIEWPORT, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      });
      expect(swept.size).toBe(0);
    });
  });
});
