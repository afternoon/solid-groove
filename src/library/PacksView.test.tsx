import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Analytics } from "../analytics/analytics";
import { clickAndFlush } from "../testing/events";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { FIXTURE_PACK_INDEX_DOC } from "./__fixtures__/fixtures";
import { variedPackFetcher } from "./__fixtures__/variedPackFetcher";
import { LibraryClient } from "./libraryClient";
import PacksView, { HEAR_STEP_MS, type PacksViewProps } from "./PacksView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const [first, second] = FIXTURE_PACK_INDEX_DOC.packs;

function renderPacks(overrides: Partial<PacksViewProps> = {}) {
  const engine = fakePreviewEngine();
  const onOpenPack = vi.fn();
  const logFeatureFirstUse = vi.fn();
  const rendered = render(() => (
    <PacksView
      client={new LibraryClient(variedPackFetcher())}
      previewEngine={engine}
      analytics={{ logFeatureFirstUse } as unknown as Analytics}
      projectPackIds={[first.id]}
      keyLabel={(action) => `<${action}>`}
      onOpenPack={onOpenPack}
      {...overrides}
    />
  ));
  return { ...rendered, engine, onOpenPack, logFeatureFirstUse };
}

const hearButton = (name: string) => screen.getByRole("button", { name: `Hear ${name}` });

/** Every cover shows its category count once every manifest has loaded. */
async function loadedCovers(count: number = FIXTURE_PACK_INDEX_DOC.packs.length) {
  await waitFor(() => {
    const covers = screen.getAllByRole("button", { name: /^Open / });
    expect(covers).toHaveLength(count);
    for (const cover of covers) expect(cover).toHaveTextContent("categories");
  });
}

describe("PacksView", () => {
  it("shows a monochrome cover per pack with its biggest categories, and no digit key", async () => {
    renderPacks();
    await loadedCovers();

    const open = screen.getByRole("button", { name: `Open ${first.name}` });
    expect(open).toHaveTextContent(/\+\d+ more/);
    expect(open).toHaveTextContent("CE");
    // The digits are the editor's views (UI-002), so a cover has no key.
    expect(open.querySelector("kbd")).toBeNull();
    // Spaced from the initials and key badge, so it reads as words.
    expect(open.textContent).toMatch(/\bIn project\b/);
    // Initials over waveform stripes, never artwork.
    expect(document.querySelector(".pack-cover img")).toBeNull();
    expect(document.querySelectorAll(".pack-cover path")).toHaveLength(
      FIXTURE_PACK_INDEX_DOC.packs.length * 3,
    );
  });

  it("opens a pack from its cover", async () => {
    const { onOpenPack } = renderPacks();
    await loadedCovers();

    clickAndFlush(screen.getByRole("button", { name: `Open ${second.name}` }));
    expect(onOpenPack).toHaveBeenLastCalledWith(second.slug);
  });

  it("narrows to packs with a family, and clears the filter again", async () => {
    renderPacks();
    await loadedCovers();
    const total = FIXTURE_PACK_INDEX_DOC.packs.length;
    expect(screen.getByText(`${total} of ${total} packs`)).toBeVisible();

    // The inline label still names the group of chips.
    const filter = screen.getByRole("group", { name: "Packs with" });
    expect(within(filter).getByRole("button", { name: "Anything" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    clickAndFlush(within(filter).getByRole("button", { name: "Bass" }));
    expect(screen.getByRole("button", { name: "Bass" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: `Open ${first.name}` })).toBeNull();
    expect(screen.getByRole("button", { name: /^Open Foundation Bass/ })).toBeVisible();

    clickAndFlush(screen.getByRole("button", { name: "Anything" }));
    expect(screen.getByRole("button", { name: `Open ${first.name}` })).toBeVisible();
  });

  it("reports pack_browser first use once", async () => {
    const { logFeatureFirstUse } = renderPacks();
    await loadedCovers();
    expect(logFeatureFirstUse).toHaveBeenCalledTimes(1);
    expect(logFeatureFirstUse).toHaveBeenCalledWith("pack_browser");
  });

  describe("Hear it", () => {
    async function loadedWithFakeTimers() {
      const rendered = renderPacks();
      await loadedCovers();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      return rendered;
    }

    it("auditions a run of the pack's sounds, then stops", async () => {
      const { engine } = await loadedWithFakeTimers();

      clickAndFlush(hearButton(first.name));
      expect(screen.getByRole("button", { name: `Stop ${first.name}` })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await vi.advanceTimersByTimeAsync(HEAR_STEP_MS * 10);

      expect(engine.starts.length).toBeGreaterThan(1);
      expect(new Set(engine.starts.map((start) => start.asset.packSlug))).toEqual(
        new Set([first.slug]),
      );
      expect(hearButton(first.name)).toBeVisible();
    });

    it("stops the run when pressed again, and when the view unmounts", async () => {
      const { engine, unmount } = await loadedWithFakeTimers();

      clickAndFlush(hearButton(first.name));
      await vi.advanceTimersByTimeAsync(0);
      clickAndFlush(screen.getByRole("button", { name: `Stop ${first.name}` }));
      const heard = engine.starts.length;
      await vi.advanceTimersByTimeAsync(HEAR_STEP_MS * 10);
      expect(engine.starts).toHaveLength(heard);
      expect(engine.starts.every((start) => start.stop.mock.calls.length > 0)).toBe(true);

      clickAndFlush(hearButton(first.name));
      await vi.advanceTimersByTimeAsync(0);
      unmount();
      const afterUnmount = engine.starts.length;
      await vi.advanceTimersByTimeAsync(HEAR_STEP_MS * 10);
      expect(engine.starts).toHaveLength(afterUnmount);
      // The engine belongs to the modal, which disposes it, not this view.
      expect(engine.disposed()).toBe(false);
    });
  });
});
