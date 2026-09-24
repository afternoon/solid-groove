import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePreviewEngine } from "../library/__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "../library/__fixtures__/fixtures";
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

  it("closes from its Close button", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    clickAndFlush(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderModal();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));

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
