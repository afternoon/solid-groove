import type { Project, ProjectMetadata } from "../entities";
import { type DomainIssue, issue } from "./primitives";

export function checkMetadata(metadata: ProjectMetadata): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (metadata.modifiedAt < metadata.createdAt) {
    issues.push(
      issue(
        "invalid_metadata",
        ["metadata", "modifiedAt"],
        "modifiedAt precedes createdAt",
      ),
    );
  }
  const seen = new Set<string>();
  metadata.collaboratorIds.forEach((collaboratorId, index) => {
    if (seen.has(collaboratorId)) {
      issues.push(
        issue(
          "duplicate_id",
          ["metadata", "collaboratorIds", index],
          `Collaborator ${collaboratorId} is listed more than once`,
        ),
      );
    }
    seen.add(collaboratorId);
  });
  issues.push(...checkPackDependencyList(metadata));
  return issues;
}

/**
 * The pack dependency list on its own (invariant 12), which is all a metadata
 * document can be judged on without the song's assets.
 *
 * At most one version per pack: two versions of the same pack in one project
 * would make "which audio does this project resolve?" ambiguous and is exactly
 * the silent substitution LIB-05 rules out.
 */
export function checkPackDependencyList(metadata: ProjectMetadata): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const versions = new Map<string, string>();
  metadata.packDependencies.forEach((dependency, index) => {
    const path = ["metadata", "packDependencies", index] as const;
    const existing = versions.get(dependency.packId);
    if (existing === dependency.version) {
      issues.push(
        issue(
          "duplicate_id",
          path,
          `Pack ${dependency.packId} is listed more than once at version ${dependency.version}`,
        ),
      );
    } else if (existing !== undefined) {
      issues.push(
        issue(
          "invalid_pack_reference",
          path,
          `Project depends on two versions of pack ${dependency.packId} (${existing} and ${dependency.version}); a project resolves one version per pack`,
        ),
      );
    }
    versions.set(dependency.packId, dependency.version);
  });
  return issues;
}

/**
 * Invariant 12, across metadata and song: every asset resolves from a pack the
 * project declares at the version it declares, and the declared list holds
 * nothing the project's assets do not actually use.
 *
 * The second half is what makes the list *derived* rather than hand-maintained.
 * A list that has drifted is a rejected project, not a project that quietly
 * over-reports what it needs, so `derivePackDependencies` stays the only way to
 * produce a valid one.
 */
export function checkPackQualification(project: Project): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const declared = new Map(
    project.metadata.packDependencies.map((dependency) => [
      dependency.packId as string,
      dependency.version as string,
    ]),
  );
  const used = new Set<string>();

  project.song.assets.forEach((asset, index) => {
    const path = ["song", "assets", index] as const;
    const declaredVersion = declared.get(asset.packId);
    if (declaredVersion === undefined) {
      issues.push(
        issue(
          "invalid_pack_reference",
          [...path, "packId"],
          `Asset ${asset.id} resolves from pack ${asset.packId}, which the project does not declare as a dependency`,
        ),
      );
      return;
    }
    if (declaredVersion !== asset.packVersion) {
      issues.push(
        issue(
          "invalid_pack_reference",
          [...path, "packVersion"],
          `Asset ${asset.id} resolved from pack ${asset.packId} version ${asset.packVersion}, but the project declares version ${declaredVersion}`,
        ),
      );
      return;
    }
    used.add(asset.packId);
  });

  project.metadata.packDependencies.forEach((dependency, index) => {
    if (!used.has(dependency.packId)) {
      issues.push(
        issue(
          "invalid_metadata",
          ["metadata", "packDependencies", index],
          `Pack ${dependency.packId} is declared as a dependency but no asset resolves from it; the dependency list is derived from project state, not maintained by hand`,
        ),
      );
    }
  });

  return issues;
}

/**
 * The pack shelf (`metadata.addedPacks`) against the derived dependency list
 * (LIB-08).
 *
 * The shelf is "which packs has the user added?" and the dependency list is
 * "which packs does the project use?". The shelf is *maintained* by the
 * `pack.add`/`pack.remove` commands rather than derived, so unlike
 * `packDependencies` it may hold a pack no asset uses. But it is not free-form:
 *
 * 1. **At most one version per pack.** Two versions of one pack on the shelf is
 *    the same ambiguity invariant 12 rules out for dependencies.
 * 2. **Every used pack is on the shelf, at the version it is used at.** A pack a
 *    project depends on but does not have on its shelf could be removed from the
 *    panel while its sounds still play — the shelf must be a superset of the
 *    dependency list. A shelf that lists a used pack at a *different* version
 *    contradicts what the project actually resolves, and is the drift this
 *    check rejects rather than silently reconciling.
 */
export function checkAddedPacks(project: Project): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const shelved = new Map<string, string>();
  project.metadata.addedPacks.forEach((entry, index) => {
    const path = ["metadata", "addedPacks", index] as const;
    const existing = shelved.get(entry.packId);
    if (existing === entry.version) {
      issues.push(
        issue(
          "duplicate_id",
          path,
          `Pack ${entry.packId} is on the shelf more than once at version ${entry.version}`,
        ),
      );
    } else if (existing !== undefined) {
      issues.push(
        issue(
          "invalid_pack_reference",
          path,
          `The shelf holds two versions of pack ${entry.packId} (${existing} and ${entry.version}); a project shelves one version per pack`,
        ),
      );
    }
    shelved.set(entry.packId, entry.version);
  });

  project.metadata.packDependencies.forEach((dependency, index) => {
    const shelvedVersion = shelved.get(dependency.packId);
    if (shelvedVersion === undefined) {
      issues.push(
        issue(
          "invalid_metadata",
          ["metadata", "packDependencies", index],
          `Pack ${dependency.packId} is a dependency but is not on the project's shelf (addedPacks); a used pack must be shelved so it cannot be removed from the panel while its sounds still play`,
        ),
      );
    } else if (shelvedVersion !== dependency.version) {
      issues.push(
        issue(
          "invalid_pack_reference",
          ["metadata", "packDependencies", index],
          `Pack ${dependency.packId} is used at version ${dependency.version} but shelved at version ${shelvedVersion}; the shelf must match the version the project resolves`,
        ),
      );
    }
  });

  return issues;
}
