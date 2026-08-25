import { describe, expect, it } from "vitest";
import {
  type Asset,
  checkProjectIntegrity,
  createAsset,
  createNoteEvent,
  createPack,
  derivePackDependencies,
  type NoteEvent,
  type Project,
  packVersion,
  TICKS_PER_SIXTEENTH,
} from "../domain";
import { addNotes, removeNotes, removeTrack } from ".";
import { executeCommand, executeTransaction } from "./execute";
import { CommandHistory } from "./history";
import { createCommandTestProject, createTestFactoryContext } from "./testProjects";

/**
 * Invariant 12 through the command kernel.
 *
 * The dependency list is derived, so no command definition maintains it:
 * `executeTransaction` recomputes it once, inside the transaction, before the
 * invariant check. That is what makes it atomic with the edit that changed which
 * packs the project uses, and what makes undo and redo — which replay through
 * the same path — consistent without a per-command rule.
 *
 * Note on coverage: no command registered today mutates `song.assets`, because
 * loading an asset onto an instrument arrives with the sampler and the library
 * browser (`LOOP-004`, `LOOP-013`). The "an asset from a new pack appeared" and
 * "a pack's last asset went away" transitions are therefore driven by handing
 * `executeTransaction` a project whose song assets already differ — exactly the
 * state such a command will produce — rather than by a command that cannot exist
 * yet.
 */

function newNote(seed: string, startSixteenth: number): NoteEvent {
  return createNoteEvent(createTestFactoryContext(seed), {
    startTicks: startSixteenth * TICKS_PER_SIXTEENTH,
    durationTicks: TICKS_PER_SIXTEENTH,
    pitch: 48,
  });
}

function withAsset(project: Project, asset: Asset): Project {
  return {
    ...project,
    song: { ...project.song, assets: [...project.song.assets, asset] },
  };
}

/** An asset from a pack no fixture declares. */
function newPackAsset(): Asset {
  const context = createTestFactoryContext("extra-pack");
  return createAsset(context, {
    pack: createPack(context, { name: "Extra Pack", version: "4.0.0" }),
    name: "Extra one-shot",
    storageRef: "samples/extra/one-shot.wav",
  });
}

/** Every committed project satisfies the derived-list invariant. */
function expectDerived(project: Project): void {
  expect(project.metadata.packDependencies).toEqual(derivePackDependencies(project.song));
  expect(checkProjectIntegrity(project)).toEqual([]);
}

describe("pack dependencies through a transaction", () => {
  it("carries an unchanged list through by identity, not by rebuilding it", () => {
    const { project, clipAId } = createCommandTestProject();

    const result = executeCommand(project, addNotes(clipAId, [newNote("unchanged", 6)]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A note edit is not a pack change: the same array object comes through, so
    // nothing downstream can mistake it for one.
    expect(result.project.metadata.packDependencies).toBe(
      project.metadata.packDependencies,
    );
    expectDerived(result.project);
  });

  it("declares a new pack in the same transaction that first references it", () => {
    const { project, clipAId } = createCommandTestProject();
    const asset = newPackAsset();
    const before = project.metadata.packDependencies.length;

    const result = executeCommand(
      withAsset(project, asset),
      addNotes(clipAId, [newNote("adds-pack", 6)]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.packDependencies).toHaveLength(before + 1);
    expect(result.project.metadata.packDependencies).toContainEqual({
      packId: asset.packId,
      version: asset.packVersion,
    });
    expectDerived(result.project);
    // One transaction, one revision: the pack change did not need its own.
    expect(result.project.metadata.revision).toBe(project.metadata.revision + 1);
  });

  it("drops a pack in the same transaction that removes its last asset", () => {
    const { project, clipAId, packs } = createCommandTestProject();
    const [drumsPack] = packs;
    const withoutDrumAssets: Project = {
      ...project,
      song: {
        ...project.song,
        assets: project.song.assets.filter((asset) => asset.packId !== drumsPack.id),
        // The pads that referenced those assets let go of them too, or the
        // project would hold a dangling reference rather than a pack change.
        tracks: project.song.tracks.map((track) =>
          track.instrument?.kind === "drumMachine"
            ? {
                ...track,
                instrument: {
                  ...track.instrument,
                  pads: track.instrument.pads.map((pad) => ({
                    ...pad,
                    assetId: null,
                  })),
                },
              }
            : track,
        ),
      },
    };

    expect(project.metadata.packDependencies.map((entry) => entry.packId)).toContain(
      drumsPack.id,
    );

    const result = executeCommand(
      withoutDrumAssets,
      addNotes(clipAId, [newNote("drops-pack", 6)]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.metadata.packDependencies.map((entry) => entry.packId),
    ).not.toContain(drumsPack.id);
    expectDerived(result.project);
  });

  it("repairs a drifted list rather than committing it", () => {
    const { project, clipAId } = createCommandTestProject();
    const drifted: Project = {
      ...project,
      metadata: { ...project.metadata, packDependencies: [] },
    };

    const result = executeCommand(drifted, addNotes(clipAId, [newNote("drift", 6)]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.packDependencies).toEqual(
      project.metadata.packDependencies,
    );
    expectDerived(result.project);
  });

  it("keeps a pack whose assets survive a track deletion", () => {
    const { project, trackAId } = createCommandTestProject();

    const result = executeCommand(project, removeTrack(trackAId));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dependencies follow the project's asset table, not the instruments that
    // happen to reference it: deleting a track does not discard its assets.
    expect(result.project.metadata.packDependencies).toEqual(
      project.metadata.packDependencies,
    );
    expectDerived(result.project);
  });

  it("leaves a rejected transaction's project untouched, drift included", () => {
    const { project, clipAId } = createCommandTestProject();
    const drifted: Project = {
      ...project,
      metadata: { ...project.metadata, packDependencies: [] },
    };

    const result = executeTransaction(drifted, [
      addNotes(clipAId, [newNote("first", 6)]),
      addNotes(clipAId, [newNote("first", 6)]),
    ]);

    expect(result.ok).toBe(false);
    expect(result.project).toBe(drifted);
  });

  it("rejects a transaction that would need two versions of one pack", () => {
    const { project, clipAId, packs } = createCommandTestProject();
    const context = createTestFactoryContext("repacked");
    const repacked = createAsset(context, {
      pack: { ...packs[0], version: packVersion("9.9.9") },
      name: "Repacked one-shot",
      storageRef: "samples/repacked/one-shot.wav",
    });

    const result = executeCommand(
      withAsset(project, repacked),
      addNotes(clipAId, [newNote("two-versions", 6)]),
    );

    // The derived list would hold the same pack at two versions, which no valid
    // project may do, so the whole transaction is refused and nothing changes.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("invalid_project");
    expect(result.project.metadata.packDependencies).toEqual(
      project.metadata.packDependencies,
    );
  });

  it("derives the list for a gesture step that commits no revision", () => {
    const { project, clipAId } = createCommandTestProject();
    const asset = newPackAsset();

    const result = executeTransaction(
      withAsset(project, asset),
      [addNotes(clipAId, [newNote("gesture", 6)])],
      { commitRevision: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.metadata.revision).toBe(project.metadata.revision);
    expectDerived(result.project);
  });
});

describe("pack dependencies across undo and redo", () => {
  it("stay derived through a command, its undo, and its redo", () => {
    const { project, clipAId, packs } = createCommandTestProject();
    const history = new CommandHistory(withAsset(project, newPackAsset()));
    const expected = derivePackDependencies(history.project.song);

    history.execute(addNotes(clipAId, [newNote("roundtrip", 6)]));
    expectDerived(history.project);
    expect(history.project.metadata.packDependencies).toEqual(expected);

    history.undo();
    expectDerived(history.project);
    expect(history.project.metadata.packDependencies).toEqual(expected);

    history.redo();
    expectDerived(history.project);
    expect(history.project.metadata.packDependencies).toEqual(expected);
    expect(
      history.project.metadata.packDependencies.map((entry) => entry.packId),
    ).toContain(packs[0].id);
  });

  it("survive a longer edit sequence undone and redone to the end", () => {
    const { project, clipAId, eventIds } = createCommandTestProject();
    const history = new CommandHistory(project);
    const expected = derivePackDependencies(project.song);

    history.execute(addNotes(clipAId, [newNote("one", 6)]));
    history.execute(removeNotes(clipAId, [eventIds[0]]));
    history.execute(addNotes(clipAId, [newNote("two", 7)]));

    while (history.canUndo) {
      history.undo();
      expect(history.project.metadata.packDependencies).toEqual(expected);
      expectDerived(history.project);
    }
    while (history.canRedo) {
      history.redo();
      expect(history.project.metadata.packDependencies).toEqual(expected);
      expectDerived(history.project);
    }
  });

  it("keeps a pack an undone edit did not remove", () => {
    // Undo replays inverse commands, so it rebuilds whatever song state the
    // forward transaction changed — and the list is re-derived from that state
    // rather than remembered alongside it.
    const { project, clipAId } = createCommandTestProject();
    const asset = newPackAsset();
    const history = new CommandHistory(withAsset(project, asset));

    history.execute(addNotes(clipAId, [newNote("kept", 6)]));
    const afterEdit = history.project.metadata.packDependencies;
    history.undo();

    expect(history.project.metadata.packDependencies).toEqual(afterEdit);
    expect(history.project.metadata.packDependencies).toContainEqual({
      packId: asset.packId,
      version: asset.packVersion,
    });
    expectDerived(history.project);
  });

  it("keeps a gesture's whole drag consistent and on one revision", () => {
    const { project, clipAId } = createCommandTestProject();
    const history = new CommandHistory(withAsset(project, newPackAsset()));
    const expected = derivePackDependencies(history.project.song);
    const startRevision = history.project.metadata.revision;

    const gesture = history.beginGesture({ summary: "Paint notes" });
    gesture.apply(addNotes(clipAId, [newNote("paint-1", 6)]));
    expect(history.project.metadata.packDependencies).toEqual(expected);
    gesture.apply(addNotes(clipAId, [newNote("paint-2", 7)]));
    gesture.commit();

    expect(history.project.metadata.revision).toBe(startRevision + 1);
    expect(history.project.metadata.packDependencies).toEqual(expected);
    expectDerived(history.project);
  });
});
