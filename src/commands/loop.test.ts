import { describe, expect, it } from "vitest";
import { type Project, TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain";
import { setLoopEnabled, setLoopRange } from ".";
import { executeCommand, executeTransaction } from "./execute";
import { createCommandTestProject } from "./testProjects";

function apply(project: Project, command: Parameters<typeof executeCommand>[1]): Project {
  const result = executeCommand(project, command);
  if (!result.ok) {
    throw new Error(`Expected success: ${result.issues[0].message}`);
  }
  return result.project;
}

describe("loop.setRange", () => {
  it("stores a bar-aligned range", () => {
    const { project } = createCommandTestProject();

    const next = apply(project, setLoopRange(TICKS_PER_BAR * 2, TICKS_PER_BAR * 6));

    expect(next.song.loop.startTicks).toBe(TICKS_PER_BAR * 2);
    expect(next.song.loop.endTicks).toBe(TICKS_PER_BAR * 6);
  });

  it("snaps a raw drag outwards to the bars it encloses", () => {
    // A pointer drag lands on arbitrary ticks. Rounding the start down and the
    // end up means the producer keeps every bar they touched rather than
    // losing the one they only partly covered.
    const { project } = createCommandTestProject();

    const next = apply(
      project,
      setLoopRange(TICKS_PER_BAR + TICKS_PER_SIXTEENTH, TICKS_PER_BAR * 3 - 1),
    );

    expect(next.song.loop.startTicks).toBe(TICKS_PER_BAR);
    expect(next.song.loop.endTicks).toBe(TICKS_PER_BAR * 3);
  });

  it("widens a collapsed or inverted drag to one bar", () => {
    const { project } = createCommandTestProject();

    const collapsed = apply(project, setLoopRange(TICKS_PER_BAR * 2, TICKS_PER_BAR * 2));
    expect(collapsed.song.loop).toMatchObject({
      startTicks: TICKS_PER_BAR * 2,
      endTicks: TICKS_PER_BAR * 3,
    });

    // Dragging right-to-left is the same range, not an empty one.
    const backwards = apply(project, setLoopRange(TICKS_PER_BAR * 4, TICKS_PER_BAR * 2));
    expect(backwards.song.loop).toMatchObject({
      startTicks: TICKS_PER_BAR * 2,
      endTicks: TICKS_PER_BAR * 4,
    });
  });

  it("leaves the toggle alone", () => {
    const { project } = createCommandTestProject();
    const off = apply(project, setLoopEnabled(false));

    const next = apply(off, setLoopRange(0, TICKS_PER_BAR * 4));

    expect(next.song.loop.enabled).toBe(false);
  });

  it("names the bars a producer counts in its summary", () => {
    const { project } = createCommandTestProject();

    const result = executeCommand(project, setLoopRange(0, TICKS_PER_BAR * 2));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe("Set loop to bars 1-3");
  });
});

describe("loop.setEnabled", () => {
  it("switches looping off and back on without moving the range", () => {
    const { project } = createCommandTestProject();
    const ranged = apply(project, setLoopRange(TICKS_PER_BAR, TICKS_PER_BAR * 3));

    const off = apply(ranged, setLoopEnabled(false));
    expect(off.song.loop.enabled).toBe(false);
    expect(off.song.loop.startTicks).toBe(TICKS_PER_BAR);
    expect(off.song.loop.endTicks).toBe(TICKS_PER_BAR * 3);

    const on = apply(off, setLoopEnabled(true));
    expect(on.song.loop).toEqual(ranged.song.loop);
  });
});

describe("loop edits as transactions", () => {
  it("commits one revision per edit and touches no clip", () => {
    const { project } = createCommandTestProject();

    const result = executeTransaction(project, [
      setLoopRange(TICKS_PER_BAR * 2, TICKS_PER_BAR * 4),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
    // Structural sharing is what keeps a loop edit off the clip tier: autosave
    // queues a document only when its object reference changed.
    expect(result.project.clips).toBe(project.clips);
    expect(result.project.song.tracks).toBe(project.song.tracks);
    expect(result.project.song).not.toBe(project.song);
  });

  it("leaves the project untouched when a payload is invalid", () => {
    const { project } = createCommandTestProject();

    const result = executeTransaction(project, [
      { type: "loop.setRange", payload: { startTicks: -1, endTicks: TICKS_PER_BAR } },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.project).toBe(project);
  });
});
