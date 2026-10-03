import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../domain/entities";
import {
  createDrumMachineFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { stringifyProject } from "../domain/serialize";
import {
  arrangementChunkPath,
  clipDocumentPath,
  decodeProject,
  decodeProjectMetadata,
  encodeProject,
  projectDocumentPath,
  type RawProjectDocuments,
  songDocumentPath,
} from "./documents";
import { chunkedProject } from "./projectRepositoryContract";

function documentsOf(project = createSliceFixtureProject()): RawProjectDocuments {
  const encoded = encodeProject(project);
  return {
    projectId: project.metadata.id,
    metadata: encoded.metadata.data,
    song: encoded.song.data,
    clips: encoded.clips.map((clip) => clip.data),
    arrangement: encoded.arrangement.map((chunk) => chunk.data),
  };
}

describe("schema-v1 Firestore layout", () => {
  it("puts each tier at its PRD section 9.9 path", () => {
    const project = createSliceFixtureProject();
    const encoded = encodeProject(project);
    const projectId = project.metadata.id;

    expect(encoded.metadata.path).toBe(`projects/${projectId}`);
    expect(encoded.song.path).toBe(`projects/${projectId}/song/current`);
    expect(encoded.clips.map((clip) => clip.path)).toEqual([
      `projects/${projectId}/clips/${project.clips[0].id}`,
    ]);
    expect(projectDocumentPath(projectId)).toBe(`projects/${projectId}`);
    expect(songDocumentPath(projectId)).toBe(`projects/${projectId}/song/current`);
    expect(clipDocumentPath(projectId, "clp_x")).toBe(
      `projects/${projectId}/clips/clp_x`,
    );
    expect(arrangementChunkPath(projectId, "trk_x")).toBe(
      `projects/${projectId}/arrangement/trk_x`,
    );
  });

  it("keeps ownership on the metadata document only", () => {
    const encoded = encodeProject(createSliceFixtureProject());

    expect(encoded.metadata.data.ownerId).toBe("user_fixture");
    expect(encoded.metadata.data.collaboratorIds).toEqual([]);
    expect(encoded.song.data).not.toHaveProperty("ownerId");
    expect(encoded.clips[0].data).not.toHaveProperty("ownerId");
  });

  it("stamps schema version, revision, and the owning project on every child document", () => {
    const project = createSliceFixtureProject();
    const encoded = encodeProject(project);

    for (const document of [encoded.song, ...encoded.clips]) {
      expect(document.data.schemaVersion).toBe(SCHEMA_VERSION);
      expect(document.data.revision).toBe(project.metadata.revision);
      expect(document.data.projectId).toBe(project.metadata.id);
      expect(document.data.updatedAt).toBe(project.metadata.modifiedAt);
    }
    expect(encoded.metadata.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(encoded.metadata.data.revision).toBe(project.metadata.revision);
  });

  it("stores timestamps as integer epoch milliseconds, never Firestore Timestamps", () => {
    const encoded = encodeProject(createSliceFixtureProject());

    expect(Number.isInteger(encoded.metadata.data.createdAt)).toBe(true);
    expect(Number.isInteger(encoded.metadata.data.modifiedAt)).toBe(true);
    expect(Number.isInteger(encoded.song.data.updatedAt)).toBe(true);
  });

  it("does not repeat the project ID as a metadata field", () => {
    // The document ID is the project ID; a second copy could disagree with it.
    expect(encodeProject(createSliceFixtureProject()).metadata.data).not.toHaveProperty(
      "id",
    );
  });

  it("puts the pack dependency list on the metadata document alone", () => {
    const project = createDrumMachineFixtureProject();
    const encoded = encodeProject(project);

    expect(encoded.metadata.data.packDependencies).toEqual(
      project.metadata.packDependencies,
    );
    expect(encoded.metadata.data.packDependencies).toHaveLength(2);
    // The song tier carries pack-qualified assets, not a second copy of the
    // derived list.
    expect(encoded.song.data).not.toHaveProperty("packDependencies");
    expect(encoded.clips[0].data).not.toHaveProperty("packDependencies");
    for (const asset of encoded.song.data.assets as Record<string, unknown>[]) {
      expect(typeof asset.packId).toBe("string");
      expect(typeof asset.packVersion).toBe("string");
    }
  });

  it("rejects a metadata document whose list disagrees with the song's assets", () => {
    const project = createDrumMachineFixtureProject();
    const documents = documentsOf(project);

    const decoded = decodeProject({
      ...documents,
      metadata: {
        ...(documents.metadata as Record<string, unknown>),
        packDependencies: [],
      },
    });

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues.map((issue) => issue.code)).toContain("invalid_pack_reference");
  });

  it("encodes the same project into byte-identical documents every time", () => {
    const first = encodeProject(createSliceFixtureProject());
    const second = encodeProject(createSliceFixtureProject());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("decodeProject", () => {
  it("round trips every fixture project", () => {
    for (const project of [
      createSliceFixtureProject(),
      createDrumMachineFixtureProject(),
      chunkedProject(),
    ]) {
      const decoded = decodeProject(documentsOf(project));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(stringifyProject(decoded.value)).toBe(stringifyProject(project));
    }
  });

  it("rejects a document that belongs to another project", () => {
    const documents = documentsOf();
    const foreign = {
      ...documents,
      clips: [{ ...(documents.clips[0] as object), projectId: "prj_someone_else" }],
    };

    const decoded = decodeProject(foreign);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues[0].code).toBe("cross_project_reference");
  });

  it("refuses a document written by a newer schema version", () => {
    const documents = documentsOf();
    const future = {
      ...documents,
      metadata: {
        ...(documents.metadata as object),
        schemaVersion: SCHEMA_VERSION + 1,
      },
    };

    const decoded = decodeProject(future);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues[0].code).toBe("unsupported_schema_version");
  });

  it("reports a torn write where a chunk lags its song document", () => {
    const documents = documentsOf(chunkedProject());
    const [first, ...rest] = documents.arrangement ?? [];
    const torn = {
      ...documents,
      arrangement: [{ ...(first as object), revision: 99 }, ...rest],
    };

    const decoded = decodeProject(torn);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues.map((issue) => issue.code)).toContain("revision_mismatch");
  });

  it("reports a chunk the song document expects but that was not read", () => {
    const documents = documentsOf(chunkedProject());
    const truncated = {
      ...documents,
      arrangement: (documents.arrangement ?? []).slice(1),
    };

    const decoded = decodeProject(truncated);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues.map((issue) => issue.code)).toContain("missing_document");
  });

  it("reports a missing song document rather than inventing an empty song", () => {
    const decoded = decodeProject({ ...documentsOf(), song: undefined });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues[0].code).toBe("missing_document");
  });

  it("rejects stored state that breaks a domain invariant", () => {
    const documents = documentsOf();
    const song = documents.song as { placements: unknown[] };
    const duplicated = {
      ...documents,
      song: { ...song, placements: [...song.placements, ...song.placements] },
    };

    const decoded = decodeProject(duplicated);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues.map((issue) => issue.code)).toContain("duplicate_id");
  });

  describe("references to documents that were never stored (#965)", () => {
    it("drops a placement whose clip document is missing and opens the rest", () => {
      const project = createSliceFixtureProject();
      const documents = documentsOf(project);

      const decoded = decodeProject({ ...documents, clips: [] });

      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.value.song.placements).toEqual([]);
      expect(decoded.value.song.tracks).toEqual(project.song.tracks);
      expect(decoded.dropped).toEqual({ placements: 1, clipIds: [] });
    });

    it("drops a placement held in an arrangement chunk the same way", () => {
      const project = chunkedProject();
      const documents = documentsOf(project);
      const [kept, ...missing] = project.clips;

      const decoded = decodeProject({
        ...documents,
        clips: (documents.clips as { id: string }[]).filter(
          (clip) => clip.id === kept.id,
        ),
      });

      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      const missingIds = new Set<string>(missing.map((clip) => clip.id));
      expect(
        decoded.value.song.placements.some((placement) =>
          missingIds.has(placement.clipId),
        ),
      ).toBe(false);
      expect(decoded.dropped?.placements).toBe(
        project.song.placements.filter((placement) => missingIds.has(placement.clipId))
          .length,
      );
    });

    it("drops a clip whose track the stored song no longer has", () => {
      const project = createSliceFixtureProject();
      const documents = documentsOf(project);
      const song = documents.song as Record<string, unknown>;

      const decoded = decodeProject({
        ...documents,
        song: { ...song, tracks: [], placements: [] },
      });

      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.value.clips).toEqual([]);
      expect(decoded.dropped).toEqual({ placements: 0, clipIds: [project.clips[0].id] });
    });

    it("reports nothing dropped for an intact project", () => {
      const decoded = decodeProject(documentsOf());

      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.dropped).toBeUndefined();
    });

    it("still rejects a malformed reference rather than dropping it", () => {
      const documents = documentsOf();
      const song = documents.song as { placements: Record<string, unknown>[] };

      const decoded = decodeProject({
        ...documents,
        song: {
          ...song,
          placements: song.placements.map((placement) => ({ ...placement, clipId: 7 })),
        },
      });

      expect(decoded.ok).toBe(false);
    });
  });
});

describe("decodeProjectMetadata", () => {
  it("decodes the dashboard tier on its own", () => {
    const project = createSliceFixtureProject();
    const encoded = encodeProject(project);

    const decoded = decodeProjectMetadata(project.metadata.id, encoded.metadata.data);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toEqual(project.metadata);
  });

  it("refuses metadata from a newer schema version", () => {
    const encoded = encodeProject(createSliceFixtureProject());

    const decoded = decodeProjectMetadata("prj_x", {
      ...encoded.metadata.data,
      schemaVersion: 7,
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.issues[0].code).toBe("unsupported_schema_version");
  });

  it("rejects malformed metadata", () => {
    const decoded = decodeProjectMetadata("prj_x", {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
    });
    expect(decoded.ok).toBe(false);
  });
});
