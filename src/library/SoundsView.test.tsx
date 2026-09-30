import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import { FetchClassifiedError, LibraryClient } from "./libraryClient";
import type { LibraryAsset, LibraryAssetType } from "./manifest";
import SoundsView from "./SoundsView";
import type { SoundsKeyAction } from "./soundKeys";

afterEach(() => cleanup());

function renderView(
  extra: {
    client?: LibraryClient;
    assetTypes?: readonly LibraryAssetType[];
    query?: string;
  } = {},
) {
  const engine = fakePreviewEngine();
  const onSimilar = vi.fn();
  let press: ((action: SoundsKeyAction) => void) | null = null;
  const [selected, setSelected] = createSignal<LibraryAsset | null>(null);
  render(() => (
    <SoundsView
      client={extra.client ?? new LibraryClient(fixtureFetcher())}
      previewEngine={engine}
      assetTypes={extra.assetTypes}
      query={extra.query}
      selected={selected()}
      onSelect={setSelected}
      onSimilar={onSimilar}
      onKeys={(handler) => {
        press = handler;
      }}
    />
  ));
  return {
    engine,
    onSimilar,
    selected,
    press: (action: SoundsKeyAction) => press?.(action),
  };
}

const rows = () => screen.findAllByRole("listitem");
const names = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".sound-row-name")?.textContent);

describe("SoundsView", () => {
  it("lists every pack's sounds as compact rows", async () => {
    renderView();

    const items = await rows();
    expect(items.length).toBeGreaterThan(4);
    expect(items[0].querySelector(".sound-row-meta")?.textContent).toMatch(/ · /);
    expect(items[0].querySelector("svg.mini-waveform")).not.toBeNull();
  });

  it("selects and auditions a row on click, and shows it as selected", async () => {
    const { engine, selected } = renderView();
    const [first] = await rows();

    fireEvent.click(first.querySelector(".sound-row-main") as HTMLElement);

    await waitFor(() => expect(engine.starts).toHaveLength(1));
    expect(selected()?.name).toBe(engine.starts[0].asset.name);
    expect(first).toHaveClass("sound-row-selected");
  });

  it("steps with the arrow keys, auditioning each, clamped at both ends", async () => {
    const { engine, press } = renderView();
    await rows();

    press("library.select_next");
    await waitFor(() => expect(engine.starts).toHaveLength(1));
    expect(engine.starts[0].asset.name).toBe(names()[0]);
    press("library.select_next");
    await waitFor(() => expect(engine.starts).toHaveLength(2));
    expect(engine.starts[1].asset.name).toBe(names()[1]);
    press("library.select_previous");
    await waitFor(() => expect(engine.starts).toHaveLength(3));
    expect(engine.starts[2].asset.name).toBe(names()[0]);
    // Already at the first: nothing more to hear.
    press("library.select_previous");
    expect(engine.starts).toHaveLength(3);
  });

  it("re-auditions the selected sound on Space, and ignores it with nothing selected", async () => {
    const { engine, press } = renderView();
    const [first] = await rows();

    press("library.audition");
    expect(engine.starts).toHaveLength(0);

    fireEvent.click(first.querySelector(".sound-row-main") as HTMLElement);
    await waitFor(() => expect(engine.starts).toHaveLength(1));
    press("library.audition");
    await waitFor(() => expect(engine.starts).toHaveLength(2));
    expect(engine.starts[1].asset.name).toBe(engine.starts[0].asset.name);
  });

  it("asks for similar sounds on S, for the selected sound only", async () => {
    const { onSimilar, press, selected } = renderView();
    const [first] = await rows();

    press("library.similar");
    expect(onSimilar).not.toHaveBeenCalled();

    fireEvent.click(first.querySelector(".sound-row-main") as HTMLElement);
    await waitFor(() => expect(selected()).not.toBeNull());
    press("library.similar");
    expect(onSimilar).toHaveBeenCalledWith(selected());
  });

  it("shows only the asked-for asset types", async () => {
    renderView({ assetTypes: ["loop"] });

    for (const item of await rows()) {
      expect(item.querySelector(".sound-row-length")?.textContent).toMatch(/BPM|bar/);
    }
  });

  it("narrows to what the header search matches", async () => {
    renderView({ query: "kick" });

    const items = await rows();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.textContent?.toLowerCase()).toContain("kick");
  });

  it("says when nothing matches", async () => {
    renderView({ query: "zzzz-no-such-sound" });

    expect(await screen.findByText("No sounds to show.")).toBeVisible();
  });

  it("says why the library is missing, and retries", async () => {
    let attempt = 0;
    const client = new LibraryClient(async (path) => {
      attempt++;
      if (attempt === 1) throw new FetchClassifiedError("network", "offline");
      return fixtureFetcher()(path);
    });
    renderView({ client });

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect((await rows()).length).toBeGreaterThan(0);
  });
});
