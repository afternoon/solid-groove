import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePreviewEngine } from "../library/__fixtures__/fakePreviewEngine";
import {
  FIXTURE_PACK_INDEX_DOC,
  fixtureFetcher,
  fixturePackManifest,
} from "../library/__fixtures__/fixtures";
import { LibraryClient } from "../library/libraryClient";
import { packAssets, parsePackManifest } from "../library/manifest";
import { clickAndFlush } from "../testing/events";
import LibraryModal, { type LibraryActions } from "./LibraryModal";

afterEach(cleanup);

function renderModal(
  overrides: Partial<{
    onInsert: () => void;
    onClose: () => void;
    previewEngine: ReturnType<typeof fakePreviewEngine>;
  }> = {},
) {
  const engine = overrides.previewEngine ?? fakePreviewEngine();
  const rendered = render(() => (
    <LibraryModal
      client={new LibraryClient(fixtureFetcher())}
      previewEngine={engine}
      onInsert={overrides.onInsert ?? (() => {})}
      addedPackIds={[]}
      onClose={overrides.onClose ?? (() => {})}
    />
  ));
  return { ...rendered, engine };
}

describe("LibraryModal", () => {
  it("is a named modal window holding the library browser", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Library" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("region", { name: "Library" })).toBeVisible();
  });

  it("closes from its close control", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    clickAndFlush(screen.getByRole("button", { name: "Close library" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderModal();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close library" }),
    );

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("disposes the audition engine it was given when it closes", () => {
    // `useLibraryBrowser` disposes the engine on unmount and a disposed
    // `ToneAuditionEngine` stays disposed, so the host has to build a fresh
    // one per open — which is only safe if closing really does dispose
    // (LOOP-013).
    const engine = fakePreviewEngine();
    const { unmount } = renderModal({ previewEngine: engine });
    expect(engine.disposed()).toBe(false);

    unmount();

    expect(engine.disposed()).toBe(true);
  });
});

describe("LibraryModal hot-swap", () => {
  it("auditions a selected sound in the slot, and puts the slot back when it closes", async () => {
    const heard: (string | null)[] = [];
    const slot = {
      preview: vi.fn((asset: { name: string }) => heard.push(asset.name) > 0),
      clear: vi.fn(() => heard.push(null)),
      isPlaying: () => true,
    };
    const engine = fakePreviewEngine();
    const { unmount } = render(() => (
      <LibraryModal
        client={new LibraryClient(fixtureFetcher())}
        previewEngine={engine}
        slotAudition={slot}
        onInsert={() => {}}
        addedPackIds={[]}
        onClose={() => {}}
      />
    ));
    const [first, second] = await screen.findAllByRole("listitem");
    const hear = (row: HTMLElement) =>
      fireEvent.click(row.querySelector(".sound-row-main") as HTMLElement);

    hear(first);
    await waitFor(() => expect(heard).toHaveLength(1));
    hear(second);
    await waitFor(() => expect(slot.preview).toHaveBeenCalledTimes(3));

    // Heard in the beat, not standalone: the transport is running.
    expect(engine.starts).toHaveLength(0);
    // The slot is left on the selected sound: the one Insert would put there.
    const insert = screen.getByRole("button", { name: /^Insert / });
    expect(insert).toHaveTextContent(`Insert ${heard.at(-1)}`);
    unmount();
    expect(heard.at(-1)).toBeNull();
  });
});

describe("LibraryModal shell", () => {
  const pack = FIXTURE_PACK_INDEX_DOC.packs[0];

  function renderShell(
    extra: {
      onInsert?: () => void;
      onActions?: (a: LibraryActions | null) => void;
      keyLabel?: (a: string) => string;
    } = {},
  ) {
    return render(() => (
      <LibraryModal
        client={new LibraryClient(fixtureFetcher())}
        previewEngine={fakePreviewEngine()}
        onInsert={extra.onInsert ?? (() => {})}
        addedPackIds={[pack.id]}
        slot="Drums · BD"
        current="Rounded Club Kick"
        onActions={extra.onActions}
        keyLabel={extra.keyLabel}
        onClose={() => {}}
      />
    ));
  }

  async function hearFirstSound() {
    const [row] = await screen.findAllByRole("listitem");
    fireEvent.click(row.querySelector(".sound-row-main") as HTMLElement);
  }

  it("names the slot and what it was, then Hearing and Insert follow the selection", async () => {
    const onInsert = vi.fn();
    renderShell({ onInsert });
    expect(screen.getByText("Drums · BD")).toBeVisible();
    expect(screen.getByRole("group", { name: "Was" })).toHaveTextContent(
      "Rounded Club Kick",
    );
    expect(screen.getByRole("group", { name: "Hearing" })).toHaveTextContent(
      "Nothing yet",
    );
    expect(screen.getByText("Nothing yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();

    await hearFirstSound();

    const insert = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(".library-modal-insert");
      expect(button).toBeEnabled();
      return button as HTMLButtonElement;
    });
    expect(insert).toHaveTextContent(/^Insert .+/);
    expect(screen.queryByText("Nothing yet")).toBeNull();
    clickAndFlush(insert);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("badges the rail and footer from the registry, and swaps in placeholders", () => {
    renderShell({ keyLabel: (action) => `<${action}>` });
    const rail = within(screen.getByRole("navigation", { name: "Places" }));
    const place = (name: string) => rail.getByRole("button", { name: new RegExp(name) });
    expect(place("All sounds")).toHaveAttribute("aria-current", "true");
    expect(place("Browse packs")).toHaveTextContent("<library.browse_packs>");
    expect(screen.getByRole("group", { name: "In this project" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Shuffle/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveTextContent(
      "<help.shortcut_guide>",
    );

    clickAndFlush(place("Favourites"));
    expect(screen.queryByRole("region", { name: "Library" })).toBeNull();
    expect(screen.getByText("Favourites will appear here.")).toBeVisible();
    // Shuffle picks from a list of sounds, which only All sounds has for now.
    expect(screen.getByRole("button", { name: /Shuffle/ })).toBeDisabled();
  });

  it("hands the host its shortcut actions, and takes them back on close", () => {
    const onActions = vi.fn();
    const { unmount } = renderShell({ onActions });
    const actions = onActions.mock.calls[0][0] as LibraryActions;

    expect(actions.insertSelected()).toBe(false);
    actions.press("library.select_next");
    actions.showView("packs");
    unmount();
    expect(onActions).toHaveBeenLastCalledWith(null);
  });

  it("opens similar sounds for the selected sound, and backs out of it", async () => {
    const onActions = vi.fn();
    renderShell({ onActions });
    const actions = onActions.mock.calls[0][0] as LibraryActions;
    expect(actions.similar()).toBe(false);
    expect(actions.back()).toBe(false);

    await hearFirstSound();
    expect(actions.similar()).toBe(true);
    flush();
    await screen.findByRole("navigation", { name: "Similar sounds trail" });
    expect(screen.queryByRole("region", { name: "Library" })).toBeNull();
    // The way back names the list it returns to, as the shelf in view calls it.
    expect(screen.getByRole("button", { name: /^Back to All \w+$/ })).toBeVisible();

    expect(actions.back()).toBe(true);
    flush();
    expect(screen.queryByRole("navigation", { name: "Similar sounds trail" })).toBeNull();
    expect(screen.getByRole("region", { name: "Library" })).toBeVisible();
  });

  it("opens similar sounds from a row's icon and from the S key", async () => {
    const onActions = vi.fn();
    renderShell({ onActions });
    const actions = onActions.mock.calls[0][0] as LibraryActions;
    const trail = () =>
      screen.queryByRole("navigation", { name: "Similar sounds trail" });

    clickAndFlush((await screen.findAllByRole("button", { name: /^Sounds like / }))[0]);
    expect(
      await screen.findByRole("navigation", { name: "Similar sounds trail" }),
    ).toBeVisible();
    expect(actions.back()).toBe(true);
    flush();
    expect(trail()).toBeNull();

    await hearFirstSound();
    await waitFor(() => expect(screen.queryByText("Nothing yet")).toBeNull());
    actions.press("library.similar");
    flush();
    expect(
      await screen.findByRole("navigation", { name: "Similar sounds trail" }),
    ).toBeVisible();
  });

  it("narrows the sounds as you type in the header search", async () => {
    renderShell();
    await screen.findAllByRole("listitem");

    fireEvent.input(screen.getByRole("searchbox", { name: "Search sounds" }), {
      target: { value: "zzzz-no-such-sound" },
    });

    expect(await screen.findByText("No sounds match these filters.")).toBeVisible();
  });

  it("forwards a library key to the sounds view, and Down leaves the search field", async () => {
    const onActions = vi.fn();
    renderShell({ onActions });
    await screen.findAllByRole("listitem");
    const actions = onActions.mock.calls[0][0] as LibraryActions;
    const search = screen.getByRole("searchbox", { name: "Search sounds" });
    search.focus();

    actions.press("library.select_next");

    await waitFor(() => expect(screen.queryByText("Nothing yet")).toBeNull());
    expect(document.activeElement).not.toBe(search);
    expect(actions.insertSelected()).toBe(true);
  });

  it("shuffles from the footer, and the search key focuses the search field", async () => {
    const onActions = vi.fn();
    renderShell({ onActions });
    await screen.findAllByRole("listitem");
    const actions = onActions.mock.calls[0][0] as LibraryActions;

    clickAndFlush(screen.getByRole("button", { name: /Shuffle/ }));
    await waitFor(() => expect(screen.queryByText("Nothing yet")).toBeNull());

    actions.press("library.search");
    expect(document.activeElement).toBe(
      screen.getByRole("searchbox", { name: "Search sounds" }),
    );
  });
});

describe("LibraryModal packs", () => {
  const [drums, bass] = FIXTURE_PACK_INDEX_DOC.packs;

  function renderPacks(addedPackIds: string[] = [drums.id]) {
    let actions: LibraryActions | null = null;
    render(() => (
      <LibraryModal
        client={new LibraryClient(fixtureFetcher())}
        previewEngine={fakePreviewEngine()}
        onInsert={() => {}}
        addedPackIds={addedPackIds}
        onActions={(next) => {
          actions = next;
        }}
        onClose={() => {}}
      />
    ));
    const rail = within(screen.getByRole("navigation", { name: "Places" }));
    return {
      browsePacks: () =>
        clickAndFlush(rail.getByRole("button", { name: /Browse packs/ })),
      actions: () => actions as unknown as LibraryActions,
    };
  }

  /** The names of the sounds the (scoped) sounds view lists. */
  const listed = () =>
    within(screen.getByRole("list", { name: "Sounds" }))
      .getAllByRole("button", { name: /^Audition / })
      .map((button) => button.getAttribute("aria-label")?.replace(/^Audition /, ""));

  it("swaps the list for the cover grid under Browse packs", async () => {
    const { browsePacks } = renderPacks();
    browsePacks();

    const grid = await screen.findByRole("region", { name: "Packs" });
    expect(
      await within(grid).findByRole("button", { name: `Open ${bass.name}` }),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Library" })).toBeNull();
  });

  it("opens a pack with its banner over a scoped list, and Backspace goes back", async () => {
    const { browsePacks, actions } = renderPacks();
    browsePacks();
    clickAndFlush(await screen.findByRole("button", { name: `Open ${drums.name}` }));

    const banner = await screen.findByRole("region", { name: `About ${drums.name}` });
    expect(banner).toHaveTextContent(drums.publisher);
    expect(banner).toHaveTextContent(`v${drums.version}`);
    expect(banner).toHaveTextContent(drums.description);
    expect(banner).toHaveTextContent("In this project");
    // The sounds view shows, scoped to this pack alone.
    expect(await screen.findByRole("region", { name: "Library" })).toBeVisible();
    const inPack = new Set(
      packAssets(parsePackManifest(fixturePackManifest(drums.slug))).map((a) => a.name),
    );
    await waitFor(() => expect(listed().length).toBeGreaterThan(0));
    expect(listed().every((name) => inPack.has(name ?? ""))).toBe(true);

    actions().back();
    expect(await screen.findByRole("region", { name: "Packs" })).toBeVisible();
    expect(screen.queryByRole("region", { name: `About ${drums.name}` })).toBeNull();

    actions().back();
    expect(await screen.findByRole("region", { name: "Library" })).toBeVisible();
  });

  it("says a pack joins the project on insert when the project lacks it, and opens by digit", async () => {
    const { browsePacks, actions } = renderPacks([drums.id]);
    browsePacks();
    await screen.findByRole("button", { name: `Open ${bass.name}` });

    actions().press("library.pick_2");

    const banner = await screen.findByRole("region", { name: `About ${bass.name}` });
    expect(banner).toHaveTextContent("Joins the project when you insert a sound");
  });

  it("backs out of similar sounds, then the pack, then Browse packs", async () => {
    const { browsePacks, actions } = renderPacks();
    browsePacks();
    clickAndFlush(await screen.findByRole("button", { name: `Open ${drums.name}` }));
    clickAndFlush((await screen.findAllByRole("button", { name: /^Sounds like / }))[0]);
    await screen.findByRole("navigation", { name: "Similar sounds trail" });

    expect(actions().back()).toBe(true);
    expect(
      await screen.findByRole("region", { name: `About ${drums.name}` }),
    ).toBeVisible();
    expect(actions().back()).toBe(true);
    expect(await screen.findByRole("region", { name: "Packs" })).toBeVisible();
    expect(actions().back()).toBe(true);
    expect(await screen.findByRole("region", { name: "Library" })).toBeVisible();
    expect(actions().back()).toBe(false);
  });

  it("lists the project's packs in the rail, and opens one", async () => {
    const { actions } = renderPacks([bass.id]);
    const project = within(await screen.findByRole("group", { name: "In this project" }));

    const pack = await project.findByRole("button", { name: new RegExp(bass.name) });
    expect(project.getAllByRole("button")).toHaveLength(1);
    clickAndFlush(pack);

    expect(await screen.findByRole("heading", { name: bass.name })).toBeVisible();
    expect(pack).toHaveAttribute("aria-pressed", "true");
    actions().back();
    await waitFor(() => expect(pack).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByRole("heading", { name: bass.name })).toBeNull();
  });
});
