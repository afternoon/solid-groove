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
import LibraryModal from "./LibraryModal";

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

  function renderShell(extra: { onInsert?: () => void } = {}) {
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
        onClose={() => {}}
      />
    ));
  }

  async function hearFirstSound() {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(pack.name) }));
    const group = await waitFor(() => {
      const groups = screen
        .getAllByRole("button", { expanded: false })
        .filter((button) => button.classList.contains("library-node-group"));
      expect(groups.length).toBeGreaterThan(0);
      return groups[0];
    });
    fireEvent.click(group);
    const audition = await waitFor(
      () => screen.getAllByRole("button", { name: /^Audition / })[0],
    );
    fireEvent.click(audition);
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
});
