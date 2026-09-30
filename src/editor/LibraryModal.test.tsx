import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePreviewEngine } from "../library/__fixtures__/fakePreviewEngine";
import { FIXTURE_PACK_INDEX_DOC, fixtureFetcher } from "../library/__fixtures__/fixtures";
import { LibraryClient } from "../library/libraryClient";
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
      onAddPack={() => {}}
      onPackBrowserOpenChange={() => {}}
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
        onAddPack={() => {}}
        onPackBrowserOpenChange={() => {}}
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
    expect(screen.getByText("Rounded Club Kick")).toBeVisible();
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
    expect(place("All sounds")).toHaveAttribute("aria-pressed", "true");
    expect(place("Browse packs")).toHaveTextContent("<library.browse_packs>");
    expect(place("In this project")).not.toHaveTextContent("<");
    expect(screen.getByRole("button", { name: /Shuffle/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveTextContent(
      "<help.shortcut_guide>",
    );

    clickAndFlush(place("Favourites"));
    expect(screen.queryByRole("region", { name: "Library" })).toBeNull();
    expect(screen.getByText("Favourites will appear here.")).toBeVisible();
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

  it("narrows the sounds as you type in the header search", async () => {
    renderShell();
    await screen.findAllByRole("listitem");

    fireEvent.input(screen.getByRole("searchbox", { name: "Search sounds" }), {
      target: { value: "zzzz-no-such-sound" },
    });

    expect(await screen.findByText("No sounds to show.")).toBeVisible();
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
});
