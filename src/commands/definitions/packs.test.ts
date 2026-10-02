import { describe, expect, it } from "vitest";
import {
  checkProjectIntegrity,
  createSeededIdFactory,
  type PackDependency,
  type Project,
  packVersion,
} from "../../domain";
import { executeCommand } from "../execute";
import { CommandHistory } from "../history";
import { createCommandTestProject } from "../testProjects";
import { addPack, removePack, setPackVersion } from "./packs";

/**
 * The pack-shelf commands (LIB-08).
 *
 * The shelf is maintained by these commands, not derived, so they carry the
 * rules the derivation cannot: one version per pack, a used pack cannot be
 * unshelved, and every committed project still satisfies the shelf invariant.
 */

function freshPack(seed: string): PackDependency {
  return {
    packId: createSeededIdFactory(seed)("pack"),
    version: packVersion("1.0.0"),
  };
}

function expectValid(project: Project): void {
  expect(checkProjectIntegrity(project)).toEqual([]);
}

describe("pack.add", () => {
  it("shelves a new pack and commits one revision", () => {
    const { project } = createCommandTestProject();
    const pack = freshPack("add-one");
    const before = project.metadata.addedPacks.length;

    const result = executeCommand(project, addPack(pack));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.addedPacks).toContainEqual(pack);
    expect(result.project.metadata.addedPacks).toHaveLength(before + 1);
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
    expectValid(result.project);
  });

  it("preserves an added pack the project uses no asset from", () => {
    const { project } = createCommandTestProject();
    const pack = freshPack("unused");

    const result = executeCommand(project, addPack(pack));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The pack is on the shelf but never in the derived dependency list.
    expect(result.project.metadata.addedPacks).toContainEqual(pack);
    expect(result.project.metadata.packDependencies).not.toContainEqual(pack);
    expectValid(result.project);
  });

  it("refuses a pack that is already on the shelf at the same version", () => {
    const { project } = createCommandTestProject();
    const existing = project.metadata.addedPacks[0];

    const result = executeCommand(project, addPack(existing));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toContain("already on the project's shelf");
    expect(result.project).toBe(project);
  });

  it("refuses a second version of a pack already on the shelf", () => {
    const { project } = createCommandTestProject();
    const existing = project.metadata.addedPacks[0];

    const result = executeCommand(
      project,
      addPack({ packId: existing.packId, version: packVersion("9.9.9") }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toContain("one version per pack");
  });
});

describe("pack.remove", () => {
  it("unshelves an added-but-unused pack and commits one revision", () => {
    const { project, shelfOnlyPack } = createCommandTestProject();
    const entry: PackDependency = {
      packId: shelfOnlyPack.id,
      version: shelfOnlyPack.version,
    };

    const result = executeCommand(project, removePack(entry));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.addedPacks).not.toContainEqual(entry);
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
    expectValid(result.project);
  });

  it("refuses to remove a pack whose assets the project uses", () => {
    const { project } = createCommandTestProject();
    // The first dependency is a pack the project actually uses.
    const used = project.metadata.packDependencies[0];

    const result = executeCommand(project, removePack(used));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toContain("in use by this project");
    // The used pack stays shelved rather than being silently dropped.
    expect(result.project).toBe(project);
    expect(project.metadata.addedPacks).toContainEqual(used);
  });

  it("refuses to remove a pack that is not on the shelf", () => {
    const { project } = createCommandTestProject();

    const result = executeCommand(project, removePack(freshPack("absent")));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toContain("not on the project's shelf");
  });
});

describe("pack.setVersion (#892)", () => {
  const NEXT = packVersion("9.1.0");

  it("moves every asset of the pack, its dependency and its shelf entry, in one revision", () => {
    const { project, packs } = createCommandTestProject();
    const [pack, other] = packs;

    const result = executeCommand(project, setPackVersion(pack.id, pack.version, NEXT));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.project;
    for (const asset of next.song.assets.filter((entry) => entry.packId === pack.id)) {
      expect(asset.packVersion).toBe(NEXT);
    }
    // Another pack's assets are untouched.
    for (const asset of next.song.assets.filter((entry) => entry.packId === other.id)) {
      expect(asset.packVersion).toBe(other.version);
    }
    expect(next.metadata.packDependencies).toContainEqual({
      packId: pack.id,
      version: NEXT,
    });
    expect(next.metadata.packDependencies).not.toContainEqual({
      packId: pack.id,
      version: pack.version,
    });
    expect(next.metadata.addedPacks).toContainEqual({ packId: pack.id, version: NEXT });
    expect(next.metadata.revision).toBe(project.metadata.revision + 1);
    expectValid(next);
  });

  it("moves a shelved pack the project draws no sound from", () => {
    const { project, shelfOnlyPack } = createCommandTestProject();

    const result = executeCommand(
      project,
      setPackVersion(shelfOnlyPack.id, shelfOnlyPack.version, NEXT),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.addedPacks).toContainEqual({
      packId: shelfOnlyPack.id,
      version: NEXT,
    });
    expectValid(result.project);
  });

  it("undoes to the old pin in one step", () => {
    const { project, packs } = createCommandTestProject();
    const [pack] = packs;
    const history = new CommandHistory(project);

    history.execute(setPackVersion(pack.id, pack.version, NEXT));
    history.undo();

    expect(history.project.song.assets).toEqual(project.song.assets);
    expect(history.project.metadata.packDependencies).toEqual(
      project.metadata.packDependencies,
    );
    expect(history.project.metadata.addedPacks).toEqual(project.metadata.addedPacks);
  });

  it("refuses a version the project does not pin", () => {
    const { project, packs } = createCommandTestProject();
    const [pack] = packs;

    const result = executeCommand(
      project,
      setPackVersion(pack.id, packVersion("0.0.1"), NEXT),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].message).toContain(`at version ${pack.version}`);
    expect(result.project).toBe(project);
  });

  it("refuses a pack the project does not have, and a move to the same version", () => {
    const { project, packs } = createCommandTestProject();
    const absent = freshPack("absent-upgrade");

    const missing = executeCommand(
      project,
      setPackVersion(absent.packId, absent.version, NEXT),
    );
    const same = executeCommand(
      project,
      setPackVersion(packs[0].id, packs[0].version, packs[0].version),
    );

    expect(missing.ok).toBe(false);
    expect(same.ok).toBe(false);
  });
});

describe("pack shelf survives a saved reload roundtrip in memory", () => {
  it("keeps an added-but-unused pack across undo and redo", () => {
    const { project } = createCommandTestProject();
    const pack = freshPack("roundtrip");
    const history = new CommandHistory(project);

    history.execute(addPack(pack));
    expect(history.project.metadata.addedPacks).toContainEqual(pack);

    history.undo();
    expect(history.project.metadata.addedPacks).not.toContainEqual(pack);

    history.redo();
    expect(history.project.metadata.addedPacks).toContainEqual(pack);
    expectValid(history.project);
  });
});
