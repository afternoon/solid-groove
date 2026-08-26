import { cleanup, renderHook } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeNotes } from "../commands";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { ClipId } from "../domain/ids";
import { createInMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { useEditorSession } from "./useEditorSession";

afterEach(() => {
  cleanup();
});

/**
 * The PRD `PRJ-03` navigation-flush half of `LOOP-002`: a queued-but-not-yet-
 * written edit must reach the repository when the browser signals the page
 * might not run again, not only when the in-app router tears the session
 * down (that half is `useEditorSession`'s existing `onCleanup`, exercised by
 * the "changing projects" test below).
 */
describe("useEditorSession navigation flush", () => {
  it("flushes a queued edit on pagehide, before the coalescing window elapses", async () => {
    const repository = createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    repository.clearWrites();

    const clip = project.clips[0];
    if (clip.content.kind !== "notes") throw new Error("expected a note clip");
    const clipId = clip.id as ClipId;
    const eventId = clip.content.events[0].id;

    const { result } = renderHook(
      () =>
        useEditorSession(
          () => project.metadata.id,
          () => repository,
        ),
      {},
    );

    await vi.waitFor(() => expect(result.state.loading).toBe(false));

    result.dispatch(removeNotes(clipId, [eventId]));
    // Solid 2 batches writes: the autosave subscription has already written
    // the queued status into the store, but a read only sees it once the
    // batch flushes. `flush()` is that synchronous catch-up point, and a test
    // asserting immediately after an action is exactly what it is for.
    flush();
    expect(result.state.saveStatus?.pending).toBe(1);
    // Nothing has reached the repository yet — the default coalescing
    // window (400ms) has not elapsed and no real time has passed in this
    // test.
    expect(repository.writes).toHaveLength(0);

    window.dispatchEvent(new Event("pagehide"));
    // `flush()` writes are async even once started; let the promise chain it
    // kicked off actually settle.
    await vi.waitFor(() => expect(repository.writes.length).toBeGreaterThan(0));

    const loaded = await repository.loadProject(project.metadata.id);
    if (!loaded.ok) throw new Error("expected the project to load");
    const savedClip = loaded.value.clips.find((c) => c.id === clipId);
    if (savedClip?.content.kind !== "notes") throw new Error("expected notes");
    expect(savedClip.content.events.some((event) => event.id === eventId)).toBe(false);
  });

  it("flushes a queued edit on visibilitychange to hidden", async () => {
    const repository = createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    repository.clearWrites();

    const clip = project.clips[0];
    if (clip.content.kind !== "notes") throw new Error("expected a note clip");
    const clipId = clip.id as ClipId;
    const eventId = clip.content.events[0].id;

    const { result } = renderHook(
      () =>
        useEditorSession(
          () => project.metadata.id,
          () => repository,
        ),
      {},
    );

    await vi.waitFor(() => expect(result.state.loading).toBe(false));

    result.dispatch(removeNotes(clipId, [eventId]));
    expect(repository.writes).toHaveLength(0);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => expect(repository.writes.length).toBeGreaterThan(0));
    vi.restoreAllMocks();
  });

  it("still flushes on unmount (in-app navigation away from the project)", async () => {
    const repository = createInMemoryProjectRepository();
    const project = createSliceFixtureProject();
    const created = await repository.createProject(project);
    if (!created.ok) throw new Error("fixture project failed to create");
    repository.clearWrites();

    const clip = project.clips[0];
    if (clip.content.kind !== "notes") throw new Error("expected a note clip");
    const clipId = clip.id as ClipId;
    const eventId = clip.content.events[0].id;

    const { result, cleanup: cleanupHook } = renderHook(
      () =>
        useEditorSession(
          () => project.metadata.id,
          () => repository,
        ),
      {},
    );

    await vi.waitFor(() => expect(result.state.loading).toBe(false));

    result.dispatch(removeNotes(clipId, [eventId]));
    expect(repository.writes).toHaveLength(0);

    cleanupHook();

    await vi.waitFor(() => expect(repository.writes.length).toBeGreaterThan(0));
  });
});
