import { describe, expect, it } from "vitest";
import { loadFixtureJson, loadStoredProjectFixture } from "./fixtures";

describe("loadFixtureJson", () => {
  it("reads and parses a fixture from public/fixtures/ via the Node path", async () => {
    const fixture = await loadFixtureJson<{ projectId: string }>(
      "persistence/v1-slice-project.json",
    );
    expect(fixture.projectId).toBe("prj_MADZjOuKZuvpTFSgrGadL");
  });

  it("rejects a fixture that does not exist", async () => {
    await expect(loadFixtureJson("does-not-exist.json")).rejects.toThrow();
  });
});

describe("loadStoredProjectFixture", () => {
  it("loads the schema-v1 persistence fixture's raw stored documents", async () => {
    const documents = await loadStoredProjectFixture("v1-slice-project.json");
    expect(documents.projectId).toBe("prj_MADZjOuKZuvpTFSgrGadL");
    expect(documents.metadata).toBeDefined();
    expect(documents.song).toBeDefined();
    expect(Array.isArray(documents.clips)).toBe(true);
  });
});
