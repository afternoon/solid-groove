import { beforeEach, describe, expect, it } from "vitest";
import { setKey } from ".";
import { executeCommand } from "./execute";
import { createCommandHistory } from "./history";
import { type CommandTestProject, createCommandTestProject } from "./testProjects";

describe("key.set (ARR-010)", () => {
  let fixture: CommandTestProject;

  beforeEach(() => {
    fixture = createCommandTestProject();
  });

  it("starts a project chromatic", () => {
    expect(fixture.project.song.key).toEqual({ root: 0, scale: "chromatic" });
  });

  it("sets the key as one revision and one history entry, and undoes it", () => {
    const history = createCommandHistory(fixture.project);

    const result = history.execute(setKey({ root: 0, scale: "minor" }));

    expect(result.ok).toBe(true);
    expect(history.project.song.key).toEqual({ root: 0, scale: "minor" });
    expect(history.project.metadata.revision).toBe(fixture.project.metadata.revision + 1);
    expect(history.entries).toHaveLength(1);
    expect(history.undoSummary).toBe("Set the key to C minor");

    history.undo();
    expect(history.project.song.key).toEqual({ root: 0, scale: "chromatic" });
    history.redo();
    expect(history.project.song.key).toEqual({ root: 0, scale: "minor" });
  });

  it("changes only the key, leaving the rest of the song as it was", () => {
    const result = executeCommand(fixture.project, setKey({ root: 7, scale: "dorian" }));

    if (!result.ok) throw new Error(result.issues[0].message);
    expect(result.summary).toBe("Set the key to G dorian");
    expect({ ...result.project.song, key: fixture.project.song.key }).toEqual(
      fixture.project.song,
    );
    expect(result.project.clips).toBe(fixture.project.clips);
  });

  it("names a multi-word scale and a sharp root the way a person reads them", () => {
    const result = executeCommand(
      fixture.project,
      setKey({ root: 6, scale: "harmonic_minor" }),
    );
    expect(result.ok && result.summary).toBe("Set the key to F# harmonic minor");
  });

  it.each([
    ["a chromatic key with a root", { root: 3, scale: "chromatic" }],
    ["a root past B", { root: 12, scale: "major" }],
    ["an unknown scale", { root: 0, scale: "lydian" }],
  ])("rejects %s and leaves the project untouched", (_label, payload) => {
    const result = executeCommand(fixture.project, { type: "key.set", payload });

    expect(result.ok).toBe(false);
    expect(result.project).toBe(fixture.project);
  });
});
