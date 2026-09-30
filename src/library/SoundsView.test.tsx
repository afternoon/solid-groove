import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import { FetchClassifiedError, LibraryClient } from "./libraryClient";
import type { LibraryAsset, LibraryAssetType } from "./manifest";
import SoundsView from "./SoundsView";

afterEach(() => cleanup());

function renderView(
  extra: {
    client?: LibraryClient;
    assetTypes?: readonly LibraryAssetType[];
    query?: string;
  } = {},
) {
  const engine = fakePreviewEngine();
  const [selected, setSelected] = createSignal<LibraryAsset | null>(null);
  render(() => (
    <SoundsView
      client={extra.client ?? new LibraryClient(fixtureFetcher())}
      previewEngine={engine}
      assetTypes={extra.assetTypes}
      query={extra.query}
      selected={selected()}
      onSelect={setSelected}
      onSimilar={() => {}}
    />
  ));
  return { engine, selected };
}

const rows = () => screen.findAllByRole("listitem");

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
