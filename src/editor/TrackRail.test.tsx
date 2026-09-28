import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../domain/entities";
import { createReferenceProject } from "../domain/fixtures";
import type { TrackId } from "../domain/ids";
import { dragTrackHandle, stubTrackDragLayout } from "../testing/trackDrag";
import TrackRail from "./TrackRail";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TrackRail reorder (#447)", () => {
  it("drags a row to reorder its track, previewing it in its new place", async () => {
    const [a, b, c] = createReferenceProject({ trackCount: 3, placementCount: 3 }).song
      .tracks;
    const [tracks] = createSignal<readonly Track[]>([a, b, c]);
    const onReorder = vi.fn<(trackId: TrackId, toIndex: number) => void>();
    render(() => (
      <TrackRail
        tracks={tracks()}
        selectedTrackId={null}
        onSelect={() => {}}
        onReorder={onReorder}
      />
    ));
    stubTrackDragLayout({
      axis: "y",
      zoneSelector: ".track-rail",
      size: 80,
      zoneLength: 240,
      order: () => tracks().map((track) => track.id),
    });
    const row = (track: Track) => screen.getByRole("button", { name: track.name });

    dragTrackHandle(row(c), { x: 50, y: 2 }, () => {
      const shown = [...document.querySelectorAll<HTMLElement>("[data-track-drag]")];
      expect(shown.map((li) => li.dataset.trackDrag)).toEqual([c.id, a.id, b.id]);
      expect(shown[0]).toHaveClass("track-dragging");
      expect(onReorder).not.toHaveBeenCalled();
    });
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(c.id, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("is not a drag handle without a reorder handler", () => {
    const [a] = createReferenceProject({ trackCount: 1, placementCount: 1 }).song.tracks;
    render(() => <TrackRail tracks={[a]} selectedTrackId={null} onSelect={() => {}} />);
    expect(document.querySelector("[data-track-drag]")).toBeNull();
  });
});
