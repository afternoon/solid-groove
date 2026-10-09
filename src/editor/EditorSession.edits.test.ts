import { describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { setParameter } from "../commands";
import { createSliceFixtureProject } from "../domain/fixtures";
import { TRACK_VOLUME } from "../domain/parameters";
import { createInMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { createManualClock } from "../shared/clock";
import { memoryStorage } from "../testing/storage";
import { EditorSession, type SessionEdit } from "./EditorSession";

async function setUp() {
  const repository = createInMemoryProjectRepository();
  const project = createSliceFixtureProject();
  const created = await repository.createProject(project);
  if (!created.ok) throw new Error("fixture project failed to create");
  const analytics = new Analytics({
    transport: createRecordingTransport(),
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  const session = new EditorSession({
    repository,
    project,
    clock: createManualClock(1_000),
    analytics,
    deviceStorage: memoryStorage(),
  });
  const edits: SessionEdit[] = [];
  session.subscribeEdits((edit) => edits.push(edit));
  const trackId = project.song.tracks[0].id;
  const volume = (value: number) =>
    setParameter({ scope: "track", trackId, parameterId: TRACK_VOLUME.id }, value);
  return { repository, project, session, edits, volume };
}

describe("EditorSession.subscribeEdits (GRV-5)", () => {
  it("reports a dispatch with its actor, correlation ID, commands and the project before", async () => {
    const { session, edits, volume, project } = await setUp();
    session.dispatch(volume(-3), { actor: "assistant", correlationId: "asp_1" });
    expect(edits).toHaveLength(1);
    const [edit] = edits;
    expect(edit).toMatchObject({
      kind: "edit",
      actor: "assistant",
      correlationId: "asp_1",
    });
    expect(edit?.commands.map((command) => command.type)).toEqual(["parameter.set"]);
    expect(edit?.before).toBe(project);
  });

  it("reports an undo and a redo of an entry under that entry's correlation ID", async () => {
    const { session, edits, volume } = await setUp();
    session.dispatch(volume(-3), { actor: "assistant", correlationId: "asp_1" });
    session.undo();
    session.redo();
    expect(edits.map((edit) => [edit.kind, edit.correlationId])).toEqual([
      ["edit", "asp_1"],
      ["undo", "asp_1"],
      ["redo", "asp_1"],
    ]);
    expect(edits[1]?.commands.map((command) => command.type)).toEqual(["parameter.set"]);
  });

  it("reports a gesture once, when it commits, and a cancelled one never", async () => {
    const { session, edits, volume } = await setUp();
    const cancelled = session.beginGesture();
    cancelled.apply(volume(-1));
    cancelled.cancel();
    expect(edits).toHaveLength(0);

    const gesture = session.beginGesture();
    gesture.apply(volume(-1));
    gesture.apply(volume(-2));
    expect(edits).toHaveLength(0);
    gesture.commit();
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("edit");
    expect(edits[0]?.actor).toBe("user");
  });

  it("reports nothing for a preview, nor for a remote change", async () => {
    const { session, edits, volume, repository, project } = await setUp();
    const cancelled = session.beginPreview(volume(-6));
    if (!cancelled.ok) throw new Error("the preview was refused");
    cancelled.preview.cancel();
    // A remote change moves the committed revision, which ends this one stale.
    const open = session.beginPreview(volume(-6));
    if (!open.ok) throw new Error("the preview was refused");
    const remote = await repository.saveMetadata(
      project.metadata.id,
      { name: "Renamed elsewhere" },
      project.metadata.revision,
    );
    expect(remote.ok).toBe(true);
    await vi.waitFor(() => expect(open.preview.endReason).toBe("remote_change"));
    expect(edits).toHaveLength(0);
  });

  it("tells a remote-change listener when a change made elsewhere is adopted", async () => {
    const { session, repository, project } = await setUp();
    let remote = 0;
    const unsubscribe = session.subscribeRemoteChanges(() => {
      remote += 1;
    });
    const saved = await repository.saveMetadata(
      project.metadata.id,
      { name: "Renamed elsewhere" },
      project.metadata.revision,
    );
    expect(saved.ok).toBe(true);
    await vi.waitFor(() => expect(remote).toBe(1));
    unsubscribe();
    // This client's own echo is not a change made elsewhere.
    session.autosave.applyRemote({ kind: "metadata", metadata: project.metadata });
    expect(remote).toBe(1);
  });

  it("stops reporting once unsubscribed", async () => {
    const { session, volume } = await setUp();
    const seen: SessionEdit[] = [];
    const unsubscribe = session.subscribeEdits((edit) => seen.push(edit));
    unsubscribe();
    session.dispatch(volume(-3));
    expect(seen).toHaveLength(0);
  });
});
