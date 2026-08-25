import { describe, expect, it } from "vitest";
import { isEntityId } from "../domain/ids";
import { assertProject } from "../domain/parse";
import { createStarterProject } from "./starterProject";

describe("createStarterProject", () => {
  it("builds a valid schema-v1 project", () => {
    const project = createStarterProject("user_1");
    // Throws if invalid; a successful call is the assertion.
    expect(() => assertProject(project)).not.toThrow();
  });

  it("has one sampler track whose asset resolves through a pack", () => {
    const project = createStarterProject("user_1");

    expect(project.song.tracks).toHaveLength(1);
    const track = project.song.tracks[0];
    expect(track.instrument?.kind).toBe("sampler");

    expect(project.song.assets).toHaveLength(1);
    const asset = project.song.assets[0];
    expect(track.instrument?.kind === "sampler" && track.instrument.assetId).toBe(
      asset.id,
    );

    expect(project.metadata.packDependencies).toEqual([
      { packId: asset.packId, version: asset.packVersion },
    ]);
  });

  it("has a one-bar four-on-the-floor note clip placed once", () => {
    const project = createStarterProject("user_1");

    expect(project.clips).toHaveLength(1);
    const clip = project.clips[0];
    expect(clip.content.kind).toBe("notes");
    if (clip.content.kind === "notes") {
      expect(clip.content.events).toHaveLength(4);
    }
    expect(project.song.placements).toHaveLength(1);
    expect(project.song.placements[0].clipId).toBe(clip.id);
  });

  it("builds independent projects on each call", () => {
    const a = createStarterProject("user_1");
    const b = createStarterProject("user_1");
    expect(a.metadata.id).not.toBe(b.metadata.id);
    expect(isEntityId("project", a.metadata.id)).toBe(true);
  });

  it("owns the project by the given user", () => {
    const project = createStarterProject("user_42");
    expect(project.metadata.ownerId).toBe("user_42");
  });
});
