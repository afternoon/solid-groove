import { describe, expect, it } from "vitest";
import { executeCommand } from "../execute";
import { createCommandTestProject } from "../testProjects";
import { renameProject } from "./project";

describe("project.rename", () => {
  it("changes only the name and commits one revision", () => {
    const { project } = createCommandTestProject();
    const result = executeCommand(project, renameProject("Night Drive"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.name).toBe("Night Drive");
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
    expect(result.project.song).toBe(project.song);
    expect(result.project.clips).toBe(project.clips);
  });

  it("summarizes the new name", () => {
    const { project } = createCommandTestProject();
    const result = executeCommand(project, renameProject("Night Drive"));
    expect(result.ok && result.summary).toContain("Night Drive");
  });

  it("rejects an empty or overlong name and leaves the project untouched", () => {
    const { project } = createCommandTestProject();
    for (const name of ["", "x".repeat(121)]) {
      const result = executeCommand(project, renameProject(name));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.project).toBe(project);
    }
  });
});
