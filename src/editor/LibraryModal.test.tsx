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
import LibraryModal, {
  type LibraryActions,
  type LibraryModalProps,
} from "./LibraryModal";

afterEach(cleanup);

function renderModal(
  overrides: Partial<{
    onInsert: LibraryModalProps["onInsert"];
    previewEngine: ReturnType<typeof fakePreviewEngine>;
  }> = {},
) {
  const engine = overrides.previewEngine ?? fakePreviewEngine();
  const rendered = render(() => (
    <LibraryModal
      client={new LibraryClient(fixtureFetcher())}
      previewEngine={engine}
      onInsert={overrides.onInsert ?? (() => undefined)}
      addedPackIds={[]}
    />
  ));
  return { ...rendered, engine };
}

describe("LibraryModal", () => {
  it("is a named region, not a dialog, holding the library browser (UI-002)", () => {
    renderModal();

    const view = screen.getByRole("region", { name: "Library" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(view).getByRole("region", { name: "Browse sounds" })).toBeVisible();
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
        onInsert={() => undefined}
        addedPackIds={[]}
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
      onInsert?: () => undefined;
      onActions?: (a: LibraryActions | null) => void;
      keyLabel?: (a: string) => string;
    } = {},
  ) {
    return render(() => (
      <LibraryModal
        client={new LibraryClient(fixtureFetcher())}
        previewEngine={fakePreviewEngine()}
        onInsert={extra.onInsert ?? (() => undefined)}
        addedPackIds={[pack.id]}
        eyebrow="Drums · Pad 1"
        slot="BD"
        current="Rounded Club Kick"
        onActions={extra.onActions}
        keyLabel={extra.keyLabel}
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
    // The eyebrow says where the slot sits; the pad's own name is the title.
    const slot = screen.getByText("BD");
    expect(slot.tagName).toBe("B");
    expect(slot.previousElementSibling).toHaveTextContent("Drums · Pad 1");
    expect(slot.previousElementSibling).toHaveClass("library-modal-label");
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
    expect(screen.queryByRole("region", { name: "Browse sounds" })).toBeNull();
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
    expect(screen.queryByRole("region", { name: "Browse sounds" })).toBeNull();
    // The way back names the list it returns to, as the shelf in view calls it.
    expect(screen.getByRole("button", { name: /^Back to All \w+$/ })).toBeVisible();

    expect(actions.back()).toBe(true);
    flush();
    expect(screen.queryByRole("navigation", { name: "Similar sounds trail" })).toBeNull();
    expect(screen.getByRole("region", { name: "Browse sounds" })).toBeVisible();
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

  it("clears the search from its own control, shown only while there is a query", async () => {
    renderShell();
    await screen.findAllByRole("listitem");
    const search = screen.getByRole("searchbox", { name: "Search sounds" });
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    fireEvent.input(search, { target: { value: "zzzz-no-such-sound" } });
    flush();
    clickAndFlush(screen.getByRole("button", { name: "Clear search" }));

    expect(search).toHaveValue("");
    expect(document.activeElement).toBe(search);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect((await screen.findAllByRole("listitem")).length).toBeGreaterThan(0);
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

describe("LibraryModal footer and rail", () => {
  const [drums] = FIXTURE_PACK_INDEX_DOC.packs;
  const label = (action: string) => `<${action}>`;

  function renderSlot(fetcher = fixtureFetcher()) {
    const slot = { preview: () => true, clear: () => {}, isPlaying: () => true };
    render(() => (
      <LibraryModal
        client={new LibraryClient(fetcher)}
        previewEngine={fakePreviewEngine()}
        slotAudition={slot}
        slotKind="drum-pad"
        slot="BD"
        current="Rounded Club Kick"
        keyLabel={label}
        onInsert={() => undefined}
        addedPackIds={[drums.id]}
      />
    ));
    return within(screen.getByRole("navigation", { name: "Places" }));
  }
  const hint = () => document.querySelector(".library-modal-hint");

  it("teaches the slot and its keys, with different words over packs and similar sounds", async () => {
    const rail = renderSlot();
    await screen.findAllByRole("listitem");
    expect(hint()).toHaveTextContent(
      "Sounds play in the BD pad over your beat. <library.select_previous> " +
        "<library.select_next> for the next, <view.close_surface> puts back Rounded Club Kick.",
    );

    clickAndFlush(rail.getByRole("button", { name: /^Browse packs/ }));
    expect(hint()).toHaveTextContent(/^Pick a pack to see its sounds\.$/);

    clickAndFlush(rail.getByRole("button", { name: /^All sounds/ }));
    clickAndFlush((await screen.findAllByRole("button", { name: /^Sounds like / }))[0]);
    await screen.findByRole("navigation", { name: "Similar sounds trail" });
    expect(hint()).toHaveTextContent(
      /^Every result plays in the BD pad\. Press its similar/,
    );
  });

  it("selects an opened pack's own rail row rather than Browse packs", async () => {
    const rail = renderSlot();
    const browse = rail.getByRole("button", { name: /^Browse packs/ });
    clickAndFlush(browse);
    expect(browse).toHaveAttribute("aria-current", "true");

    clickAndFlush(await screen.findByRole("button", { name: `Open ${drums.name}` }));

    const project = within(screen.getByRole("group", { name: "In this project" }));
    expect(project.getByRole("button", { name: new RegExp(drums.name) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(browse).not.toHaveAttribute("aria-current");
  });

  it("says the project's packs couldn't load when the pack index fails", async () => {
    renderSlot(async () => {
      throw new Error("offline");
    });
    const project = screen.getByRole("group", { name: "In this project" });
    expect(await within(project).findByText("Packs couldn't load.")).toBeVisible();
  });

  it("badges Insert with the registry's key without changing its name", async () => {
    renderSlot();
    const insert = screen.getByRole("button", { name: "Insert" });
    const badge = within(insert).getByText("<library.insert>");
    expect(badge).toHaveClass("library-modal-key");
    expect(badge).toHaveAttribute("aria-hidden", "true");
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
        onInsert={() => undefined}
        addedPackIds={addedPackIds}
        onActions={(next) => {
          actions = next;
        }}
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
    expect(screen.queryByRole("region", { name: "Browse sounds" })).toBeNull();
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
    expect(await screen.findByRole("region", { name: "Browse sounds" })).toBeVisible();
    const inPack = new Set(
      packAssets(parsePackManifest(fixturePackManifest(drums.slug))).map((a) => a.name),
    );
    await waitFor(() => expect(listed().length).toBeGreaterThan(0));
    expect(listed().every((name) => inPack.has(name ?? ""))).toBe(true);

    actions().back();
    expect(await screen.findByRole("region", { name: "Packs" })).toBeVisible();
    expect(screen.queryByRole("region", { name: `About ${drums.name}` })).toBeNull();

    actions().back();
    expect(await screen.findByRole("region", { name: "Browse sounds" })).toBeVisible();
  });

  it("says a pack joins the project on insert when the project lacks it", async () => {
    const { browsePacks } = renderPacks([drums.id]);
    browsePacks();
    clickAndFlush(await screen.findByRole("button", { name: `Open ${bass.name}` }));

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
    expect(await screen.findByRole("region", { name: "Browse sounds" })).toBeVisible();
    expect(actions().back()).toBe(false);
  });

  it("leaves an opened pack from its banner's close button", async () => {
    const { browsePacks } = renderPacks();
    browsePacks();
    clickAndFlush(await screen.findByRole("button", { name: `Open ${drums.name}` }));
    const banner = await screen.findByRole("region", { name: `About ${drums.name}` });

    clickAndFlush(within(banner).getByRole("button", { name: "Back to all sounds" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: `About ${drums.name}` })).toBeNull(),
    );
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

describe("LibraryModal refused inserts (#892)", () => {
  async function selectSound(index: number) {
    const rows = await screen.findAllByRole("listitem");
    fireEvent.click(rows[index].querySelector(".sound-row-main") as HTMLElement);
    return waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(".library-modal-insert");
      expect(button).toBeEnabled();
      return button as HTMLButtonElement;
    });
  }

  const upgrade = { packName: "Core Electronic Drums", version: "1.1.0", missing: 2 };

  it("shows a refusal's sentence beside Insert, keeps the view, and clears it on the next selection", async () => {
    renderModal({
      onInsert: () => ({ ok: false, reason: "Couldn't insert it: no sampler." }),
    });

    clickAndFlush(await selectSound(0));

    expect(await screen.findByText("Couldn't insert it: no sampler.")).toBeVisible();
    expect(screen.getByRole("region", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upgrade anyway" })).toBeNull();

    await selectSound(1);
    await waitFor(() =>
      expect(screen.queryByText("Couldn't insert it: no sampler.")).toBeNull(),
    );
  });

  it("asks before an upgrade that leaves sounds missing, and Upgrade anyway inserts", async () => {
    const onInsert = vi.fn((_asset: unknown, options: { upgradeAnyway: boolean }) =>
      options.upgradeAnyway ? { ok: true as const } : { ok: false as const, upgrade },
    );
    renderModal({ onInsert });

    clickAndFlush(await selectSound(0));

    expect(
      await screen.findByText(
        "Inserting this moves the project to Core Electronic Drums 1.1.0, which leaves 2 sounds in this project missing.",
      ),
    ).toBeVisible();
    expect(onInsert).toHaveBeenLastCalledWith(expect.anything(), {
      upgradeAnyway: false,
    });
    clickAndFlush(screen.getByRole("button", { name: "Upgrade anyway" }));

    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(2));
    expect(onInsert).toHaveBeenLastCalledWith(expect.anything(), { upgradeAnyway: true });
  });

  it("Cancel changes nothing and leaves the couldn't-insert message, still offering the upgrade", async () => {
    const onInsert = vi.fn(() => ({ ok: false as const, upgrade }));
    renderModal({ onInsert });

    clickAndFlush(await selectSound(0));
    clickAndFlush(await screen.findByRole("button", { name: "Cancel" }));

    const notice = document.querySelector(".library-modal-notice");
    expect(notice).toHaveTextContent(
      /^Couldn't insert .+: it needs Core Electronic Drums 1\.1\.0, which leaves 2 sounds in this project missing\./,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Upgrade anyway" })).toBeVisible();
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("says when the newer version could not be checked, and still offers the upgrade", async () => {
    renderModal({
      onInsert: () => ({ ok: false, upgrade: { ...upgrade, missing: null } }),
    });

    clickAndFlush(await selectSound(0));

    expect(
      await screen.findByText(
        /didn't load, so this project's sounds couldn't be checked/,
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Upgrade anyway" })).toBeVisible();
  });
});
