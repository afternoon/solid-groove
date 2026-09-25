import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import {
  FIXTURE_PACK_INDEX_DOC,
  fixtureFetcher,
  fixturePackManifest,
} from "./__fixtures__/fixtures";
import AssetRow from "./AssetRow";
import { readLibrarySampleDrag } from "./assetDrag";
import LibraryBrowser from "./LibraryBrowser";
import { FetchClassifiedError, LibraryClient } from "./libraryClient";
import { type LibraryAsset, packAssets, parsePackManifest } from "./manifest";

afterEach(() => cleanup());

/** The delivered pack ids the fixture index lists, in its own order. */
const FIXTURE_PACK_IDS = FIXTURE_PACK_INDEX_DOC.packs.map((pack) => pack.id);
const FIRST_PACK = FIXTURE_PACK_INDEX_DOC.packs[0];
const SECOND_PACK = FIXTURE_PACK_INDEX_DOC.packs[1];

function analytics() {
  const transport = createRecordingTransport();
  const instance = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  instance.setAccountType("anonymous");
  return { analytics: instance, transport };
}

function renderBrowser(
  overrides: {
    client?: LibraryClient;
    previewEngine?: ReturnType<typeof fakePreviewEngine>;
    analytics?: Analytics;
    onInsert?: (asset: unknown) => void;
    addedPackIds?: readonly string[];
    onAddPack?: (pack: { id: string }) => void;
    onPackBrowserOpenChange?: (open: boolean) => void;
  } = {},
) {
  const client = overrides.client ?? new LibraryClient(fixtureFetcher());
  const previewEngine = overrides.previewEngine ?? fakePreviewEngine();
  render(() => (
    <LibraryBrowser
      client={client}
      previewEngine={previewEngine}
      analytics={overrides.analytics}
      onInsert={overrides.onInsert}
      addedPackIds={overrides.addedPackIds ?? [FIRST_PACK.id, SECOND_PACK.id]}
      onAddPack={overrides.onAddPack}
      onPackBrowserOpenChange={overrides.onPackBrowserOpenChange}
    />
  ));
  return { previewEngine };
}

/** The tree's disclosure for a pack or a role group. */
function node(name: string | RegExp) {
  return screen.getByRole("button", { name, expanded: undefined });
}

/** Opens a pack's node, as a producer does first: every pack starts closed. */
async function openPack(pack: { name: string } = FIRST_PACK) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(pack.name) }));
}

describe("the pack tree (LIB-05)", () => {
  it("shows one node per pack the project has, each closed until opened", async () => {
    renderBrowser();
    const first = await screen.findByRole("button", {
      name: new RegExp(FIRST_PACK.name),
    });
    // The library is opened to pick a sound (UI-001), and opening the pack
    // you want is the first step of that (CF-005): nothing opens on its own.
    expect(first).toHaveAttribute("aria-expanded", "false");
    const second = screen.getByRole("button", {
      name: new RegExp(SECOND_PACK.name),
    });
    expect(second).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-expanded", "true"));
    expect(second).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a pack's own structure — role groups, then its sounds", async () => {
    renderBrowser();
    await openPack();
    // The opened pack's role groups appear without any taxonomy knowledge.
    const group = await waitFor(() => {
      const groups = screen
        .getAllByRole("button", { expanded: false })
        .filter((button) => button.classList.contains("library-node-group"));
      expect(groups.length).toBeGreaterThan(0);
      return groups[0];
    });
    // A group is collapsed until opened; opening it reveals auditionable sounds.
    expect(screen.queryAllByRole("button", { name: /^Audition / })).toHaveLength(0);
    fireEvent.click(group);
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^Audition / }).length,
      ).toBeGreaterThan(0),
    );
  });

  it("loads a pack's manifest only when its node is expanded", async () => {
    const paths: string[] = [];
    const client = new LibraryClient(async (path) => {
      paths.push(path);
      return fixtureFetcher()(path);
    });
    renderBrowser({ client });
    await screen.findByRole("button", {
      name: new RegExp(SECOND_PACK.name),
    });
    // The project's first pack is warmed so opening it is instant; no other
    // manifest is fetched until its node opens.
    await waitFor(() =>
      expect(paths.some((path) => path.includes(FIRST_PACK.slug))).toBe(true),
    );
    expect(paths.some((path) => path.includes(SECOND_PACK.slug))).toBe(false);
    fireEvent.click(node(new RegExp(SECOND_PACK.name)));
    await waitFor(() =>
      expect(paths.some((path) => path.includes(SECOND_PACK.slug))).toBe(true),
    );
  });

  it("says so when the project has no packs", async () => {
    renderBrowser({ addedPackIds: [] });
    expect(await screen.findByText(/No packs in this project/)).toBeInTheDocument();
  });
});

describe("searching the panel", () => {
  it("opens matching groups and hides the rest", async () => {
    renderBrowser();
    await openPack();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { expanded: false })
          .filter((button) => button.classList.contains("library-node-group")).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.input(screen.getByRole("searchbox", { name: "Search sounds" }), {
      target: { value: "kick" },
    });
    // A match is revealed without the user expanding anything.
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^Audition / }).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.input(screen.getByRole("searchbox", { name: "Search sounds" }), {
      target: { value: "zzzzz-no-match" },
    });
    await waitFor(() =>
      expect(screen.getByText(/No sounds match in this pack/)).toBeInTheDocument(),
    );
  });
});

describe("audition", () => {
  async function openFirstGroup() {
    await openPack();
    const group = await waitFor(() => {
      const groups = screen
        .getAllByRole("button", { expanded: false })
        .filter((button) => button.classList.contains("library-node-group"));
      expect(groups.length).toBeGreaterThan(0);
      return groups[0];
    });
    fireEvent.click(group);
    return waitFor(() => screen.getAllByRole("button", { name: /^Audition / })[0]);
  }

  it("auditions on play and toggles to stop", async () => {
    const { previewEngine } = renderBrowser();
    const auditionButton = await openFirstGroup();
    fireEvent.click(auditionButton);
    await waitFor(() => expect(previewEngine.starts.length).toBe(1));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Stop / }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Stop / })[0]);
    await waitFor(() => expect(previewEngine.starts[0].stop).toHaveBeenCalled());
  });

  it("shows a per-row error when a preview fails, without blocking others", async () => {
    const { analytics: a, transport } = analytics();
    const previewEngine = fakePreviewEngine();
    renderBrowser({ analytics: a, previewEngine });
    const auditionButton = await openFirstGroup();
    previewEngine.failNextWith("network");
    fireEvent.click(auditionButton);
    await waitFor(() => expect(transport.named("asset_load_failed")).toHaveLength(1));
    // The rest of the tree is still present and interactive.
    expect(screen.getAllByRole("button", { name: /^Audition / }).length).toBeGreaterThan(
      0,
    );
  });

  it("fires onInsert with the chosen asset", async () => {
    const onInsert = vi.fn();
    renderBrowser({ onInsert });
    await openFirstGroup();
    fireEvent.click(screen.getAllByRole("button", { name: /^Insert / })[0]);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0]).toHaveProperty("packSlug");
  });

  it("puts the sound on the drag when a row is dragged (#225)", async () => {
    renderBrowser();
    await openFirstGroup();
    const audition = screen.getAllByRole("button", { name: /^Audition / })[0];
    const name = (audition.getAttribute("aria-label") ?? "").replace("Audition ", "");
    const row = audition.closest("li");
    if (!row) throw new Error("expected the sound's row");
    expect(row.getAttribute("draggable")).toBe("true");

    const data = new Map<string, string>();
    const dataTransfer = {
      get types() {
        return [...data.keys()];
      },
      getData: (format: string) => data.get(format) ?? "",
      setData: (format: string, value: string) => {
        data.set(format, value);
      },
    };
    fireEvent.dragStart(row, { dataTransfer });

    const sample = readLibrarySampleDrag(dataTransfer);
    expect(sample?.name).toBe(name);
    expect(sample?.packId).toMatch(/^pak_/);
  });
});

describe("a row's recorded tempo (#281, INS-02)", () => {
  /** A delivered asset of `type`, so the row renders production's shape. */
  function deliveredAsset(type: LibraryAsset["type"]): LibraryAsset {
    for (const pack of FIXTURE_PACK_INDEX_DOC.packs) {
      const assets = packAssets(parsePackManifest(fixturePackManifest(pack.slug)));
      const found = assets.find((asset) => asset.type === type && asset.url);
      if (found) return found;
    }
    throw new Error(`no delivered ${type} in the fixture library`);
  }

  function renderRow(asset: LibraryAsset) {
    render(() => (
      <ul>
        <AssetRow
          asset={asset}
          active={false}
          error={null}
          onPlay={() => {}}
          onStop={() => {}}
        />
      </ul>
    ));
    return screen.getByRole("listitem");
  }

  it("states the tempo a loop was recorded at", () => {
    expect(renderRow({ ...deliveredAsset("loop"), bpm: 94 })).toHaveTextContent("94 BPM");
  });

  it("states no tempo for a one-shot, which does not follow the song", () => {
    // A one-shot is pitched, not stretched: a tempo on its row would suggest
    // it follows the song the way a loop does.
    const oneShot = { ...deliveredAsset("one-shot"), bpm: 120 };
    expect(renderRow(oneShot)).not.toHaveTextContent(/BPM/);
  });

  it("states nothing for a loop whose manifest gives no tempo", () => {
    expect(renderRow({ ...deliveredAsset("loop"), bpm: null })).not.toHaveTextContent(
      /BPM/,
    );
  });
});

describe("error states", () => {
  it("shows an actionable error and retries when the index fails", async () => {
    let attempt = 0;
    const client = new LibraryClient(async (path) => {
      attempt++;
      if (attempt === 1) throw new FetchClassifiedError("network", "offline");
      return fixtureFetcher()(path);
    });
    renderBrowser({ client });
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/Check your connection/)).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: new RegExp(FIRST_PACK.name) }),
      ).toBeInTheDocument(),
    );
  });

  it("names an unavailable pack in place while the others keep working", async () => {
    const client = new LibraryClient(async (path) => {
      if (path.includes(`/${FIRST_PACK.slug}/`)) {
        throw new FetchClassifiedError("network", "offline");
      }
      return fixtureFetcher()(path);
    });
    renderBrowser({ client });
    await openPack();
    await waitFor(() => expect(screen.getByText(/is unavailable/)).toBeInTheDocument());
    expect(screen.getByText(/Other packs work/)).toBeInTheDocument();
    // The healthy pack is still browsable.
    fireEvent.click(node(new RegExp(SECOND_PACK.name)));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { expanded: false })
          .filter((button) => button.classList.contains("library-node-group")).length,
      ).toBeGreaterThan(0),
    );
  });
});

describe("the pack browser entrypoint", () => {
  it("opens the modal, announces it, and closes on the secondary action", async () => {
    const openChanges: boolean[] = [];
    renderBrowser({
      addedPackIds: FIXTURE_PACK_IDS,
      onPackBrowserOpenChange: (open) => openChanges.push(open),
    });
    fireEvent.click(await screen.findByRole("button", { name: /Browse packs/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // The host is told, so it can hand the keyboard to the dialog context.
    expect(openChanges).toEqual([true]);
    // Scoped to the footer control this test is named for. Under Solid 1 the
    // dialog was still half-settled when the query ran, so only the header's
    // dismiss X existed and the bare name matched it -- the test read as
    // covering the secondary action while actually exercising the header.
    // Solid 2 settles the dialog before `findByRole` returns, so `PackDetail`
    // has rendered and both controls are legitimately present. Naming the
    // footer resolves the ambiguity in favour of what the test says it does.
    // The header X is now uncovered here; that is a real gap, recorded rather
    // than papered over by asserting both from one case.
    const detailActions = document.querySelector(".pack-detail-actions");
    expect(detailActions).not.toBeNull();
    fireEvent.click(
      within(detailActions as HTMLElement).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(openChanges).toEqual([true, false]);
  });

  it("stops any audition when the modal opens", async () => {
    const { previewEngine } = renderBrowser();
    await openPack();
    const group = await waitFor(() => {
      const groups = screen
        .getAllByRole("button", { expanded: false })
        .filter((button) => button.classList.contains("library-node-group"));
      expect(groups.length).toBeGreaterThan(0);
      return groups[0];
    });
    fireEvent.click(group);
    const auditionButton = await waitFor(
      () => screen.getAllByRole("button", { name: /^Audition / })[0],
    );
    fireEvent.click(auditionButton);
    await waitFor(() => expect(previewEngine.starts.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /Browse packs/ }));
    await waitFor(() => expect(previewEngine.starts[0].stop).toHaveBeenCalled());
  });
});
