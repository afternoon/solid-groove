import { beforeEach, describe, expect, it, vi } from "vitest";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH, toTicks } from "../domain";
import { createManualClock } from "../shared/clock";
import { updateNote, updateTrack } from ".";
import { executeCommand, executeTransaction } from "./execute";
import { findClip, findTrack, noteEventsOf } from "./projectEdits";
import { requireCommand } from "./registry";
import {
  ABSENT_IDS,
  type CommandTestProject,
  contentSignature,
  createCommandTestProject,
} from "./testProjects";

describe("command execution", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("produces one new revision and a fresh modified time", () => {
    const clock = createManualClock(1_700_000_500_000);
    const result = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "Sub bass" }),
      { clock },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(fixture.project.metadata.revision + 1);
    expect(result.project.metadata.revision).toBe(1);
    expect(result.project.metadata.modifiedAt).toBe(1_700_000_500_000);
    expect(findTrack(result.project, fixture.trackAId)?.name).toBe("Sub bass");
  });

  it("never mutates the project it was given", () => {
    const before = contentSignature(fixture.project);
    const result = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "Sub bass" }),
    );

    expect(result.ok).toBe(true);
    expect(contentSignature(fixture.project)).toBe(before);
    expect(findTrack(fixture.project, fixture.trackAId)?.name).toBe("Bass");
  });

  it("reuses every object it did not change", () => {
    const result = executeCommand(
      fixture.project,
      updateNote(fixture.clipAId, fixture.eventIds[0], { velocity: 0.9 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A note edit must not look like a topology change to the audio engine.
    expect(result.project.song.tracks).toBe(fixture.project.song.tracks);
    expect(result.project.song.placements).toBe(fixture.project.song.placements);
    expect(findClip(result.project, fixture.clipBId)).toBe(
      findClip(fixture.project, fixture.clipBId),
    );
    expect(findClip(result.project, fixture.clipAId)).not.toBe(
      findClip(fixture.project, fixture.clipAId),
    );
  });

  it("carries actor, correlation ID, version, and base revision on each envelope", () => {
    const result = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "Assistant pick" }),
      { actor: "assistant", correlationId: "cor_test" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "track.update",
      version: 1,
      actor: "assistant",
      correlationId: "cor_test",
      baseRevision: 0,
    });
    expect(result.actor).toBe("assistant");
  });

  it("generates a correlation ID when the caller does not supply one", () => {
    const result = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "Auto" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.correlationId).toMatch(/^cor_[\w-]{21}$/);
  });

  it("applies a multi-command transaction atomically", () => {
    const result = executeTransaction(fixture.project, [
      updateTrack(fixture.trackAId, { name: "One" }),
      updateTrack(fixture.trackBId, { name: "Two" }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findTrack(result.project, fixture.trackAId)?.name).toBe("One");
    expect(findTrack(result.project, fixture.trackBId)?.name).toBe("Two");
    // Two commands, still one revision.
    expect(result.project.metadata.revision).toBe(1);
    expect(result.summary).toContain("+1 more change");
  });

  it("rolls the whole transaction back when a later command fails", () => {
    const before = contentSignature(fixture.project);
    const result = executeTransaction(fixture.project, [
      updateTrack(fixture.trackAId, { name: "Applied first" }),
      {
        type: "track.update",
        payload: { trackId: "trk_missing", changes: {} },
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.project).toBe(fixture.project);
    expect(contentSignature(result.project)).toBe(before);
    expect(result.issues[0].commandIndex).toBe(1);
    expect(result.issues[0].code).toBe("invalid_payload");
  });

  it("reports a rejected precondition without changing anything", () => {
    const result = executeTransaction(fixture.project, [
      updateTrack(fixture.trackAId, { name: "Applied first" }),
      updateTrack(ABSENT_IDS.track, { name: "Nope" }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({
      code: "rejected",
      commandType: "track.update",
      commandIndex: 1,
    });
    expect(result.project).toBe(fixture.project);
  });

  // A command that throws would otherwise escape the kernel, so a caller that
  // correctly handles `result.ok === false` would still crash. Every phase a
  // definition contributes — transition, summary, inverse — is covered.
  it.each(["apply", "summarize", "invert"] as const)(
    "turns a command that throws in %s into a rejection",
    (phase) => {
      const definition = requireCommand("track.update");
      const spy = vi.spyOn(definition, phase).mockImplementation(() => {
        throw new Error("kaboom");
      });
      try {
        const result = executeCommand(
          fixture.project,
          updateTrack(fixture.trackAId, { name: "Sub bass" }),
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.issues[0]).toMatchObject({
          code: "rejected",
          commandType: "track.update",
          commandIndex: 0,
        });
        expect(result.issues[0].message).toMatch(/kaboom/);
        expect(result.project).toBe(fixture.project);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("refuses an unregistered command type", () => {
    const result = executeCommand(fixture.project, {
      type: "note.explode",
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("unknown_command");
  });

  it("refuses a command built for a different version", () => {
    const result = executeCommand(fixture.project, {
      ...updateTrack(fixture.trackAId, { name: "From the future" }),
      version: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("unsupported_command_version");
  });

  it("refuses an empty transaction", () => {
    const result = executeTransaction(fixture.project, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toMatch(/at least one command/);
  });

  it("refuses a command built against a stale revision", () => {
    const first = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "First" }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const stale = executeCommand(
      first.project,
      updateTrack(fixture.trackAId, { name: "Stale" }),
      { baseRevision: 0 },
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.issues[0].code).toBe("revision_conflict");
    expect(stale.project).toBe(first.project);
  });

  it("accepts a command whose base revision still matches", () => {
    const result = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "Fresh" }),
      { baseRevision: 0 },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a transition that would break a domain invariant", () => {
    const result = executeCommand(
      fixture.project,
      updateNote(fixture.clipAId, fixture.eventIds[0], {
        startTicks: toTicks(TICKS_PER_BAR * 4),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("invalid_project");
    expect(result.issues[0].domainIssues?.[0].code).toBe("invalid_musical_time");
    expect(result.project).toBe(fixture.project);
  });

  it("can apply without committing a revision, for gesture steps", () => {
    const result = executeCommand(
      fixture.project,
      updateNote(fixture.clipAId, fixture.eventIds[0], {
        startTicks: toTicks(TICKS_PER_SIXTEENTH),
      }),
      { commitRevision: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.revision).toBe(0);
    expect(result.project.metadata.modifiedAt).toBe(fixture.project.metadata.modifiedAt);
    const clip = findClip(result.project, fixture.clipAId);
    expect(clip && noteEventsOf(clip)?.[0].startTicks).toBe(TICKS_PER_SIXTEENTH);
  });

  it("never lets modifiedAt fall behind createdAt", () => {
    const result = executeCommand(
      fixture.project,
      updateTrack(fixture.trackAId, { name: "Backdated" }),
      { clock: createManualClock(0) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.modifiedAt).toBe(fixture.project.metadata.createdAt);
  });
});

/**
 * The invariant the audio graph and the arrangement renderer now depend on.
 *
 * Under Solid 1 both `useProjectAudio` and `ArrangementView` tracked the store
 * proxy directly, so they re-ran when *any* read field changed and it did not
 * matter whether an edit replaced the project root or mutated it in place.
 * Solid 2 only tracks an effect's compute half, and both compute halves now
 * read a single value whose **identity** is the trigger.
 *
 * That is correct precisely as long as an edit always produces a new root. If
 * anything ever mutates a `Project` in place instead, the audio graph silently
 * stops reconciling and the arrangement silently stops repainting -- no throw,
 * no failing assertion anywhere, because every value involved is still
 * correct. It is the worst failure shape this migration can produce, and the
 * invariant that prevents it was, until now, written down nowhere near the
 * code that would break it.
 *
 * These assertions are cheap. Losing them is not.
 */
describe("an edit replaces the project root rather than mutating it", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("returns a new root, and leaves the input untouched", () => {
    const before = fixture.project;
    const beforeSignature = contentSignature(before);

    const result = executeCommand(
      before,
      updateTrack(fixture.trackAId, { name: "Renamed" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A new root: this identity change is the whole audio/arrangement trigger.
    expect(result.project).not.toBe(before);
    // And the caller's copy is genuinely unchanged, not merely a stale alias.
    expect(contentSignature(before)).toBe(beforeSignature);
    expect(findTrack(before, fixture.trackAId)?.name).not.toBe("Renamed");
  });

  it("holds for a multi-command transaction too", () => {
    const before = fixture.project;
    const result = executeTransaction(before, [
      updateTrack(fixture.trackAId, { name: "One" }),
      updateTrack(fixture.trackBId, { name: "Two" }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).not.toBe(before);
    expect(findTrack(before, fixture.trackAId)?.name).not.toBe("One");
  });
});
