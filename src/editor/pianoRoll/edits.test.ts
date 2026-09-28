import { describe, expect, it } from "vitest";
import { createTestFactoryContext } from "../../commands/testProjects";
import type { NoteEvent } from "../../domain/entities";
import type { EventId } from "../../domain/ids";
import { createChromaticKey } from "../../domain/musicalKey";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../../domain/time";
import {
  copiesOf,
  endOfNotes,
  moveNotes,
  moveOctaves,
  pastedNotes,
  resizeEnds,
  resizeStarts,
  velocityUpdates,
} from "./edits";
import { visibleRows } from "./rows";

const STEP = TICKS_PER_SIXTEENTH;
const context = createTestFactoryContext("roll-edits");

function note(step: number, pitch: number, steps = 1, velocity = 0.8): NoteEvent {
  return {
    id: context.ids("event"),
    trigger: { kind: "pitch", pitch },
    startTicks: (step * STEP) as NoteEvent["startTicks"],
    durationTicks: (steps * STEP) as NoteEvent["durationTicks"],
    velocity,
    probability: null,
  };
}

const chromatic = visibleRows(createChromaticKey(), []);
const newIds = (count: number): EventId[] =>
  Array.from({ length: count }, () => context.ids("event"));

describe("moving notes", () => {
  it("moves by steps and rows together", () => {
    // D#2 at step 9 (index 8), up two rows and right one step: F2 at step 10.
    const [update] = moveNotes([note(8, 51)], 1, -2, chromatic, TICKS_PER_BAR);
    expect(update.changes).toEqual({
      startTicks: 9 * STEP,
      trigger: { kind: "pitch", pitch: 53 },
    });
  });

  it("steps through the rows shown, so a scale moves by degree", () => {
    const cMinor = visibleRows({ root: 0, scale: "minor" }, []);
    // D#2 (51) up one C minor row is F2 (53), skipping E.
    const [update] = moveNotes([note(0, 51)], 0, -1, cMinor, TICKS_PER_BAR);
    expect(update.changes.trigger).toEqual({ kind: "pitch", pitch: 53 });
  });

  it("stops the whole group at the clip's edges, keeping its shape", () => {
    const group = [note(0, 48), note(14, 52, 2)];
    const updates = moveNotes(group, 5, 0, chromatic, TICKS_PER_BAR);
    // The later note can only go as far as the clip's end: zero steps.
    expect(updates.map((update) => update.changes.startTicks)).toEqual([0, 14 * STEP]);
    const back = moveNotes(group, -3, 0, chromatic, TICKS_PER_BAR);
    expect(back.map((update) => update.changes.startTicks)).toEqual([0, 14 * STEP]);
  });

  it("stops the whole group at the top and bottom rows", () => {
    const updates = moveNotes(
      [note(0, 95), note(1, 90)],
      0,
      -5,
      chromatic,
      TICKS_PER_BAR,
    );
    expect(updates.map((update) => update.changes.trigger)).toEqual([
      { kind: "pitch", pitch: 96 },
      { kind: "pitch", pitch: 91 },
    ]);
  });

  it("moves by octaves, or not at all when one would leave the MIDI range", () => {
    expect(moveOctaves([note(0, 48)], 1)[0].changes.trigger).toEqual({
      kind: "pitch",
      pitch: 60,
    });
    expect(moveOctaves([note(0, 48), note(0, 120)], 1)).toEqual([]);
  });
});

describe("resizing notes", () => {
  it("moves the end by steps, never under one step or past the clip", () => {
    const notes = [note(0, 48), note(14, 50, 2)];
    expect(
      resizeEnds(notes, 1, TICKS_PER_BAR).map((u) => u.changes.durationTicks),
    ).toEqual([2 * STEP, 2 * STEP]);
    expect(
      resizeEnds(notes, -4, TICKS_PER_BAR).map((u) => u.changes.durationTicks),
    ).toEqual([STEP, STEP]);
  });

  it("moves the start by steps with the end fixed", () => {
    const [longer] = resizeStarts([note(4, 48, 2)], -2);
    expect(longer.changes).toEqual({ startTicks: 2 * STEP, durationTicks: 4 * STEP });
    const [shortest] = resizeStarts([note(4, 48, 2)], 5);
    expect(shortest.changes).toEqual({ startTicks: 5 * STEP, durationTicks: STEP });
    const [first] = resizeStarts([note(1, 48)], -3);
    expect(first.changes).toEqual({ startTicks: 0, durationTicks: 2 * STEP });
  });
});

describe("copying and pasting", () => {
  it("copies notes in place under new ids", () => {
    const original = note(2, 55);
    const [id] = newIds(1);
    expect(copiesOf([original], [id])).toEqual([{ ...original, id }]);
  });

  it("knows where a selection ends, for the insert marker", () => {
    expect(endOfNotes([note(0, 48), note(2, 55)])).toBe(3 * STEP);
    expect(endOfNotes([])).toBe(0);
  });

  it("pastes with the earliest note at the marker, pitches kept", () => {
    const clipboard = [note(0, 48), note(2, 55)];
    const pasted = pastedNotes(clipboard, 8 * STEP, TICKS_PER_BAR, newIds(2));
    expect(pasted.map((n) => [n.startTicks / STEP, n.trigger])).toEqual([
      [8, { kind: "pitch", pitch: 48 }],
      [10, { kind: "pitch", pitch: 55 }],
    ]);
    expect(new Set(pasted.map((n) => n.id)).size).toBe(2);
  });

  it("adds what fits near the clip's end", () => {
    const clipboard = [note(0, 48, 4), note(3, 55)];
    const pasted = pastedNotes(clipboard, 14 * STEP, TICKS_PER_BAR, newIds(2));
    expect(pasted).toHaveLength(1);
    expect(pasted[0].durationTicks).toBe(2 * STEP);
  });
});

describe("velocity", () => {
  it("sets the dragged note and moves the others with it", () => {
    const anchor = note(0, 48, 1, 0.5);
    const other = note(1, 50, 1, 0.9);
    const updates = velocityUpdates([anchor, other], anchor, 0.7);
    expect(updates[0].changes.velocity).toBeCloseTo(0.7);
    expect(updates[1].changes.velocity).toBe(1);
  });
});
