import { beforeEach, describe, expect, it } from "vitest";
import {
  createIdFactory,
  createSeededIdFactory,
  type NoteEvent,
  type Project,
  TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
  toTicks,
} from "../domain";
import {
  clearNotes,
  duplicateNotes,
  quantizeNotes,
  scaleNoteVelocity,
  transposeNotes,
  updateClip,
  updateNote,
  varyNotes,
} from ".";
import { executeCommand, executeTransaction } from "./execute";
import { findClip, noteEventsOf } from "./projectEdits";
import { type CommandTestProject, createCommandTestProject } from "./testProjects";

function eventsOf(
  project: Project,
  clipId: CommandTestProject["clipAId"],
): readonly NoteEvent[] {
  const clip = findClip(project, clipId);
  return clip ? (noteEventsOf(clip) ?? []) : [];
}

function clipLengthOf(project: Project, clipId: CommandTestProject["clipAId"]): number {
  return findClip(project, clipId)?.lengthTicks ?? -1;
}

function pitchesOf(project: Project, clipId: CommandTestProject["clipAId"]): number[] {
  return eventsOf(project, clipId).map((event) =>
    event.trigger.kind === "pitch" ? event.trigger.pitch : -1,
  );
}

/** Four fresh event ids, one per note in the test clip. */
function createFourIds(): string[] {
  const ids = createIdFactory();
  return Array.from({ length: 4 }, () => ids("event"));
}

/** Applies a command and unwraps the new project, failing loudly otherwise. */
function apply(project: Project, command: Parameters<typeof executeCommand>[1]): Project {
  const result = executeCommand(project, command);
  if (!result.ok) {
    throw new Error(`Expected the command to apply: ${result.issues[0].message}`);
  }
  return result.project;
}

describe("musical transformations (CLP-04)", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  describe("notes.transpose", () => {
    it("shifts every selected pitch", () => {
      const next = apply(fixture.project, transposeNotes(fixture.clipAId, null, 12));
      expect(pitchesOf(next, fixture.clipAId)).toEqual([48, 52, 56, 60]);
    });

    it("shifts only the selected notes", () => {
      const next = apply(
        fixture.project,
        transposeNotes(fixture.clipAId, [fixture.eventIds[0]], -2),
      );
      expect(pitchesOf(next, fixture.clipAId)).toEqual([34, 40, 44, 48]);
    });

    it("leaves drum-pad triggers alone", () => {
      const next = apply(fixture.project, transposeNotes(fixture.clipBId, null, 5));
      const triggers = eventsOf(next, fixture.clipBId).map((event) => event.trigger.kind);
      expect(triggers).toEqual(["pad", "pad"]);
    });

    it("refuses to clamp a note out of the MIDI range", () => {
      const result = executeCommand(
        fixture.project,
        transposeNotes(fixture.clipAId, null, 100),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].message).toMatch(/pitch range/);
    });

    it("rejects a transformation with nothing selected", () => {
      const empty = apply(fixture.project, clearNotes(fixture.clipAId));
      const result = executeCommand(empty, transposeNotes(fixture.clipAId, null, 1));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].message).toMatch(/no notes to transform/);
    });
  });

  describe("notes.scaleVelocity", () => {
    it("scales the selected velocities", () => {
      const next = apply(fixture.project, scaleNoteVelocity(fixture.clipAId, null, 1.5));
      expect(eventsOf(next, fixture.clipAId).map((e) => e.velocity)).toEqual([
        0.75, 0.75, 0.75, 0.75,
      ]);
    });

    it("clamps at the shared velocity range instead of overflowing", () => {
      const next = apply(fixture.project, scaleNoteVelocity(fixture.clipAId, null, 10));
      expect(eventsOf(next, fixture.clipAId).map((e) => e.velocity)).toEqual([
        1, 1, 1, 1,
      ]);
    });

    it("rejects a non-positive factor at the schema", () => {
      const result = executeCommand(
        fixture.project,
        scaleNoteVelocity(fixture.clipAId, null, 0),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].code).toBe("invalid_payload");
    });
  });

  describe("notes.quantize", () => {
    it("snaps fully onto the grid at full strength", () => {
      const offGrid = apply(
        fixture.project,
        updateNote(fixture.clipAId, fixture.eventIds[1], {
          startTicks: toTicks(200),
        }),
      );
      const next = apply(
        offGrid,
        quantizeNotes(fixture.clipAId, [fixture.eventIds[1]], 192, 1),
      );
      expect(eventsOf(next, fixture.clipAId)[1].startTicks).toBe(192);
    });

    it("moves part of the way at partial strength", () => {
      const offGrid = apply(
        fixture.project,
        updateNote(fixture.clipAId, fixture.eventIds[1], {
          startTicks: toTicks(200),
        }),
      );
      const next = apply(
        offGrid,
        quantizeNotes(fixture.clipAId, [fixture.eventIds[1]], 192, 0.5),
      );
      expect(eventsOf(next, fixture.clipAId)[1].startTicks).toBe(196);
    });

    it("never snaps a note past the end of its clip", () => {
      const nearEnd = apply(
        fixture.project,
        updateNote(fixture.clipAId, fixture.eventIds[3], {
          startTicks: toTicks(TICKS_PER_BAR - 8),
        }),
      );
      const next = apply(
        nearEnd,
        quantizeNotes(fixture.clipAId, [fixture.eventIds[3]], TICKS_PER_BAR, 1),
      );
      const start = eventsOf(next, fixture.clipAId)[3].startTicks;
      expect(start).toBe(0);
      expect(start).toBeLessThan(TICKS_PER_BAR);
    });
  });

  describe("notes.duplicate", () => {
    it("copies the selection at the given offset with caller-minted ids", () => {
      const ids = createSeededIdFactory("duplicate");
      const command = duplicateNotes(ids, fixture.project, {
        clipId: fixture.clipAId,
        eventIds: [fixture.eventIds[0]],
        offsetTicks: TICKS_PER_SIXTEENTH,
      });
      const next = apply(fixture.project, command);

      const events = eventsOf(next, fixture.clipAId);
      expect(events).toHaveLength(5);
      const copy = events[4];
      expect(copy.startTicks).toBe(TICKS_PER_SIXTEENTH);
      expect(copy.id).toBe(command.payload.newIds[0]);
      expect(copy.velocity).toBe(events[0].velocity);
    });

    it("duplicates the whole clip a bar later when it fits", () => {
      const wider = apply(
        fixture.project,
        // Room for the copies before duplicating them.
        {
          type: "clip.update",
          payload: {
            clipId: fixture.clipAId,
            changes: { lengthTicks: TICKS_PER_BAR * 2 },
          },
        },
      );
      const command = duplicateNotes(createIdFactory(), wider, {
        clipId: fixture.clipAId,
        offsetTicks: TICKS_PER_BAR,
      });
      const next = apply(wider, command);
      expect(eventsOf(next, fixture.clipAId)).toHaveLength(8);
    });

    // Issue #256. This used to assert the opposite: a duplicate with no room
    // rejected the whole transaction, which is the bug — the user's intent is
    // unambiguous, so the clip grows to hold the copies instead.
    it("extends the clip to the next listed length instead of rejecting", () => {
      const command = duplicateNotes(createIdFactory(), fixture.project, {
        clipId: fixture.clipAId,
        offsetTicks: TICKS_PER_BAR,
      });
      const result = executeCommand(fixture.project, command);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(clipLengthOf(result.project, fixture.clipAId)).toBe(TICKS_PER_BAR * 2);
      expect(eventsOf(result.project, fixture.clipAId)).toHaveLength(8);
      // One transaction, so one revision and one history entry.
      expect(result.revision).toBe(fixture.project.metadata.revision + 1);
      expect(result.commands).toHaveLength(1);
    });

    it("rounds the extension up to a listed length, never an unlisted one", () => {
      const wider = apply(
        fixture.project,
        updateClip(fixture.clipAId, { lengthTicks: toTicks(TICKS_PER_BAR * 2) }),
      );
      // The copies land in the third bar, which 1/2/4/8/16/32 cannot express.
      const next = apply(
        wider,
        duplicateNotes(createIdFactory(), wider, {
          clipId: fixture.clipAId,
          offsetTicks: TICKS_PER_BAR * 2,
        }),
      );
      expect(clipLengthOf(next, fixture.clipAId)).toBe(TICKS_PER_BAR * 4);
    });

    it("undoes the extension and the copies as one step", () => {
      const result = executeCommand(
        fixture.project,
        duplicateNotes(createIdFactory(), fixture.project, {
          clipId: fixture.clipAId,
          offsetTicks: TICKS_PER_BAR,
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const undone = executeTransaction(result.project, result.inverse);
      expect(undone.ok).toBe(true);
      if (!undone.ok) return;
      expect(clipLengthOf(undone.project, fixture.clipAId)).toBe(TICKS_PER_BAR);
      expect(eventsOf(undone.project, fixture.clipAId)).toHaveLength(4);
    });

    it("leaves the clip length alone when the copies already fit", () => {
      const wider = apply(
        fixture.project,
        updateClip(fixture.clipAId, { lengthTicks: toTicks(TICKS_PER_BAR * 2) }),
      );
      const next = apply(
        wider,
        duplicateNotes(createIdFactory(), wider, {
          clipId: fixture.clipAId,
          offsetTicks: TICKS_PER_BAR,
        }),
      );
      expect(clipLengthOf(next, fixture.clipAId)).toBe(TICKS_PER_BAR * 2);
    });

    it("still refuses to push a copy past the 32-bar clip maximum", () => {
      const command = duplicateNotes(createIdFactory(), fixture.project, {
        clipId: fixture.clipAId,
        offsetTicks: TICKS_PER_BAR * 32,
      });
      const result = executeCommand(fixture.project, command);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].message).toMatch(/past the end/);
    });

    it("rejects an out-of-range offset instead of throwing", () => {
      const run = () =>
        executeCommand(fixture.project, {
          type: "notes.duplicate",
          payload: {
            clipId: fixture.clipAId,
            eventIds: null,
            // Passes the payload schema, but the copy's position would
            // leave the safe-integer range that ticks live in.
            offsetTicks: Number.MAX_SAFE_INTEGER,
            newIds: createFourIds(),
          },
        });

      expect(run).not.toThrow();
      const result = run();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].code).toBe("rejected");
      expect(result.project).toBe(fixture.project);
    });

    it("refuses a payload whose new id count does not match the selection", () => {
      const result = executeCommand(fixture.project, {
        type: "notes.duplicate",
        payload: {
          clipId: fixture.clipAId,
          eventIds: null,
          offsetTicks: TICKS_PER_SIXTEENTH,
          newIds: [],
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].message).toMatch(/needs 4 new ids/);
    });
  });

  describe("notes.clear", () => {
    it("empties the clip", () => {
      const next = apply(fixture.project, clearNotes(fixture.clipAId));
      expect(eventsOf(next, fixture.clipAId)).toHaveLength(0);
      // Clearing one clip leaves the other alone.
      expect(eventsOf(next, fixture.clipBId)).toHaveLength(2);
    });

    it("rejects an already empty clip", () => {
      const empty = apply(fixture.project, clearNotes(fixture.clipAId));
      const result = executeCommand(empty, clearNotes(fixture.clipAId));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].message).toMatch(/no notes to transform/);
    });
  });

  describe("notes.vary", () => {
    const options = { seed: "swing-1", amount: 1, gridTicks: 24 };

    it("produces the same variation for the same seed", () => {
      const first = apply(fixture.project, varyNotes(fixture.clipAId, null, options));
      const second = apply(fixture.project, varyNotes(fixture.clipAId, null, options));
      expect(eventsOf(first, fixture.clipAId)).toEqual(eventsOf(second, fixture.clipAId));
    });

    it("actually varies the notes", () => {
      const next = apply(fixture.project, varyNotes(fixture.clipAId, null, options));
      expect(eventsOf(next, fixture.clipAId)).not.toEqual(
        eventsOf(fixture.project, fixture.clipAId),
      );
    });

    it("produces a different variation for a different seed", () => {
      const first = apply(fixture.project, varyNotes(fixture.clipAId, null, options));
      const other = apply(
        fixture.project,
        varyNotes(fixture.clipAId, null, { ...options, seed: "swing-2" }),
      );
      expect(eventsOf(first, fixture.clipAId)).not.toEqual(
        eventsOf(other, fixture.clipAId),
      );
    });

    it("changes nothing when the amount is zero", () => {
      const next = apply(
        fixture.project,
        varyNotes(fixture.clipAId, null, { ...options, amount: 0 }),
      );
      expect(eventsOf(next, fixture.clipAId)).toEqual(
        eventsOf(fixture.project, fixture.clipAId),
      );
    });

    it("keeps every note inside its clip", () => {
      const next = apply(
        fixture.project,
        varyNotes(fixture.clipAId, null, {
          ...options,
          gridTicks: TICKS_PER_BAR,
        }),
      );
      for (const event of eventsOf(next, fixture.clipAId)) {
        expect(event.startTicks).toBeGreaterThanOrEqual(0);
        expect(event.startTicks).toBeLessThan(TICKS_PER_BAR);
      }
    });
  });
});
