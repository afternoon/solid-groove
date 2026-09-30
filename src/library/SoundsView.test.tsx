import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import { FetchClassifiedError, LibraryClient } from "./libraryClient";
import { assetStorageRef, type LibraryAsset, type LibraryAssetType } from "./manifest";
import SoundsView from "./SoundsView";
import type { SoundsKeyAction } from "./soundKeys";
import type { ShelfSlot } from "./useShelf";

afterEach(() => cleanup());

function renderView(
  extra: {
    client?: LibraryClient;
    assetTypes?: readonly LibraryAssetType[];
    query?: string;
    slot?: ShelfSlot;
    songBpm?: number;
    onQueryChange?: (query: string) => void;
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
      slot={extra.slot}
      songBpm={extra.songBpm}
      onQueryChange={extra.onQueryChange}
      keyLabel={(action) => `<${action}>`}
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

async function libraryAssets(): Promise<LibraryAsset[]> {
  const client = new LibraryClient(fixtureFetcher());
  const loaded = await Promise.all(
    (await client.loadIndex()).map((pack) => client.loadPack(pack)),
  );
  return loaded.flatMap((result) => (result.ok ? [...result.assets] : []));
}

const tabs = () => screen.getAllByRole("tab");
const selectedTab = () =>
  tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
const chips = () => document.querySelectorAll<HTMLElement>(".shelf-chip");
const pressedChip = () =>
  [...chips()].find((chip) => chip.getAttribute("aria-pressed") === "true");

describe("SoundsView shelf", () => {
  it("opens where the slot says: a drum pad on its sound's role, the sampler on Tonal, a loop track on Loops", async () => {
    const assets = await libraryAssets();
    const held = assets.find((a) => a.type === "one-shot" && a.family === "drums");
    if (!held?.storageKey) throw new Error("fixture library has no drum one-shot");
    const ref = assetStorageRef(held.storageKey);

    cleanup();
    renderView({ slot: { kind: "drum-pad", ref } });
    await rows();
    expect(selectedTab()).toHaveTextContent(/^Drums/);
    expect(pressedChip()).toHaveTextContent(/^Kick/);

    cleanup();
    renderView({ slot: { kind: "drum-pad", ref: null } });
    await rows();
    expect(selectedTab()).toHaveTextContent(/^Drums/);
    expect(pressedChip()).toHaveTextContent(/^All Drums/);

    cleanup();
    renderView({ slot: { kind: "sampler" } });
    await rows();
    expect(selectedTab()).toHaveTextContent(/^Tonal/);

    cleanup();
    renderView({ slot: { kind: "loop-track" } });
    await rows();
    expect(selectedTab()).toHaveTextContent(/^Loops/);
  });

  it("shows only families and categories that have sounds, with counts", async () => {
    renderView({ assetTypes: ["loop"] });
    await rows();

    expect(tabs().map((tab) => tab.textContent)).toEqual([
      expect.stringMatching(/^Loops \d+$/),
    ]);
    for (const chip of chips()) expect(chip.textContent).toMatch(/\d/);
  });

  it("switches the list with a family tile and a category chip", async () => {
    renderView();
    await rows();

    fireEvent.click(screen.getByRole("tab", { name: /^Bass/ }));
    await waitFor(() => expect(selectedTab()).toHaveTextContent(/^Bass/));
    const bass = names();
    expect(bass.length).toBeGreaterThan(0);

    fireEvent.click(chips()[1]);
    await waitFor(() => expect(chips()[1]).toHaveAttribute("aria-pressed", "true"));
    expect(names().length).toBeLessThanOrEqual(bass.length);
  });

  it("badges the first nine categories and All with their registry keys", async () => {
    renderView();
    await rows();

    const [all, first] = [...chips()];
    expect(all.querySelector("kbd")?.textContent).toBe("<library.pick_all>");
    expect(first.querySelector("kbd")?.textContent).toBe("<library.pick_1>");
  });

  it("picks categories and families from the keys", async () => {
    const { press } = renderView({ slot: { kind: "loop-track" } });
    await rows();

    press("library.pick_2");
    await waitFor(() => expect(chips()[2]).toHaveAttribute("aria-pressed", "true"));
    press("library.category_next");
    await waitFor(() => expect(chips()[3]).toHaveAttribute("aria-pressed", "true"));
    press("library.category_previous");
    await waitFor(() => expect(chips()[2]).toHaveAttribute("aria-pressed", "true"));
    press("library.pick_all");
    await waitFor(() => expect(chips()[0]).toHaveAttribute("aria-pressed", "true"));
    // A digit past the last category does nothing.
    press("library.pick_9");
    press("library.category_previous");
    expect(chips()[0]).toHaveAttribute("aria-pressed", "true");

    // Loops is the last family: Next holds, Previous steps back and Next returns.
    const before = selectedTab()?.textContent;
    press("library.family_next");
    expect(selectedTab()?.textContent).toBe(before);
    press("library.family_previous");
    await waitFor(() => expect(selectedTab()?.textContent).not.toBe(before));
    press("library.family_next");
    await waitFor(() => expect(selectedTab()?.textContent).toBe(before));
  });
});

const count = () =>
  Number(document.querySelector(".filter-count")?.textContent?.match(/\d+/)?.[0]);
const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("SoundsView filters", () => {
  it("shows the live count, which follows the shelf", async () => {
    renderView();
    const listed = (await rows()).length;
    expect(count()).toBe(listed);
    expect(document.querySelector(".filter-count")).toHaveTextContent(`${listed} sounds`);
  });

  it("filters by genre from a menu that counts them, and the G key opens it", async () => {
    const { press } = renderView();
    const before = (await rows()).length;
    expect(button(/^Any genre/)).toHaveAttribute("aria-expanded", "false");

    press("library.genre_menu");
    const menu = await screen.findByRole("group", { name: "Genres" });
    expect(menu).toBeVisible();
    const options = menu.querySelectorAll("input");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.click(options[options.length - 1]);

    await waitFor(() => expect(count()).toBeLessThan(before));
    expect(screen.queryByRole("button", { name: /^Any genre/ })).toBeNull();
    press("library.genre_menu");
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Genres" })).toBeNull(),
    );
  });

  it("offers Tempo and Bars under Loops only, and the T key toggles near and any", async () => {
    const { press } = renderView({ slot: { kind: "loop-track" }, songBpm: 96 });
    await rows();
    const all = count();

    expect(screen.getByRole("group", { name: "Bars" })).toBeVisible();
    fireEvent.click(button(/^Near 96/));
    await waitFor(() => expect(count()).toBeLessThan(all));
    press("library.loop_tempo");
    await waitFor(() => expect(count()).toBe(all));
    press("library.loop_tempo");
    await waitFor(() =>
      expect(button(/^Near 96/)).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(button(/^Any tempo/));
    fireEvent.click(button("2 bars"));
    await waitFor(() => expect(count()).toBeLessThan(all));
    fireEvent.click(button("Any bars"));
    await waitFor(() => expect(count()).toBe(all));

    fireEvent.click(screen.getByRole("tab", { name: /^Drums/ }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Bars" })).toBeNull());
  });

  it("offers to clear the filters when nothing is left, and clears the search too", async () => {
    const onQueryChange = vi.fn();
    renderView({ assetTypes: ["loop"], slot: { kind: "loop-track" }, onQueryChange });
    await rows();

    fireEvent.click(button("8 bars"));
    fireEvent.click(await screen.findByRole("button", { name: "Clear the filters" }));

    await waitFor(() => expect(count()).toBeGreaterThan(0));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(button("Any bars")).toHaveAttribute("aria-pressed", "true");
  });
});
