import { describe, expect, it } from "vitest";
import { createReferenceProject, createSliceFixtureProject } from "../domain/fixtures";
import { buildAssistantContext } from "../projection/assistantContextProjection";
import { selectOnly } from "../selection/selection";
import { assistantContextPayload } from "./payload";
import { assistantContextPayloadSchema } from "./protocol";

describe("assistantContextPayload", () => {
  it("is what the gateway's allowlist schema accepts", () => {
    for (const project of [createSliceFixtureProject(), createReferenceProject()]) {
      const selection = selectOnly({ kind: "track", id: project.song.tracks[0].id });
      const payload = assistantContextPayload(buildAssistantContext(project, selection));
      expect(assistantContextPayloadSchema.parse(payload)).toEqual(payload);
    }
  });

  it("leaves out the project's ID and the app's fingerprint", () => {
    const project = createReferenceProject();
    const payload = assistantContextPayload(buildAssistantContext(project));
    expect(payload).not.toHaveProperty("projectId");
    expect(payload).not.toHaveProperty("fingerprint");
    expect(JSON.stringify(payload)).not.toContain(project.metadata.id);
    expect(JSON.stringify(payload)).not.toContain(project.metadata.ownerId);
  });
});
