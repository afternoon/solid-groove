import type { PackDependency, Project } from "../domain/entities";
import { fingerprintOf } from "./fingerprint";

/**
 * The persistence/dashboard summary projection (PRD section 9.9).
 *
 * Section 9.9's `projects/{projectId}` metadata tier is "queryable for the
 * dashboard without loading song state or clip content." This projection is
 * that same shape as a read-only view over an already-loaded `Project`: it
 * carries only what a project list needs (name, owner, timestamps, revision)
 * plus a few counts derived from the song for display, never the song or
 * clip documents themselves. `FND-004` owns the actual Firestore document
 * mapping for this tier; this is the projection any dashboard-style consumer
 * (or, per section 9.8, a compact assistant context) reads instead of poking
 * at `project.song`/`project.clips` directly.
 */
export interface ProjectSummaryProjection {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly collaboratorIds: readonly string[];
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly template: string | null;
  readonly genre: string | null;
  readonly revision: number;
  /**
   * The packs and versions the project depends on (LIB-05). It comes straight
   * off the metadata tier, so a dashboard row or an export can warn about a
   * missing pack without loading song state or clip content.
   */
  readonly packDependencies: readonly PackDependency[];
  readonly trackCount: number;
  readonly clipCount: number;
  readonly placementCount: number;
  readonly sectionCount: number;
  /** Changes whenever any summarized field changes. */
  readonly fingerprint: string;
}

export function buildProjectSummaryProjection(
  project: Project,
  previous?: ProjectSummaryProjection,
): ProjectSummaryProjection {
  const { metadata } = project;
  const shape = {
    name: metadata.name,
    ownerId: metadata.ownerId,
    collaboratorIds: [...metadata.collaboratorIds].sort(),
    createdAt: metadata.createdAt,
    modifiedAt: metadata.modifiedAt,
    template: metadata.template,
    genre: metadata.genre,
    revision: metadata.revision,
    packDependencies: [...metadata.packDependencies].sort(
      (a, b) =>
        compareStrings(a.packId, b.packId) || compareStrings(a.version, b.version),
    ),
    trackCount: project.song.tracks.length,
    clipCount: project.clips.length,
    placementCount: project.song.placements.length,
    sectionCount: project.song.sections.length,
  };
  const fingerprint = fingerprintOf(shape);
  if (previous && previous.id === metadata.id && previous.fingerprint === fingerprint) {
    return previous;
  }
  return { id: metadata.id, ...shape, fingerprint };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
