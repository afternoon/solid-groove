import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush } from "../testing/events";
import Dialog from "./Dialog";

afterEach(cleanup);

/**
 * The shared dialog shell (`UI-001`).
 *
 * What these hold to is the part a producer learns once and then expects
 * everywhere: the same name, the same ways out, and focus that comes back.
 * The three dialogs that adopted this had disagreed about all of it.
 */
describe("Dialog", () => {
  it("names itself, and names its two ways out distinctly", () => {
    render(() => (
      <Dialog label="Sequence editor" onClose={() => {}}>
        <p>contents</p>
      </Dialog>
    ));

    expect(screen.getByRole("dialog", { name: "Sequence editor" })).toBeVisible();
    // The surface's name in its own case mid-sentence, and a different verb for
    // the scrim — two controls with one name is ambiguous to anyone choosing
    // between them by name.
    expect(screen.getByRole("button", { name: "Close sequence editor" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Dismiss sequence editor" })).toBeTruthy();
  });

  it("closes from the close control and from the scrim alike", () => {
    const onClose = vi.fn();
    render(() => (
      <Dialog label="Library" onClose={onClose}>
        <p>contents</p>
      </Dialog>
    ));

    clickAndFlush(screen.getByRole("button", { name: "Close library" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    clickAndFlush(screen.getByRole("button", { name: "Dismiss library" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(() => (
      <Dialog label="Packs" onClose={() => {}}>
        <p>contents</p>
      </Dialog>
    ));

    // A dialog opened by a double-click on a canvas leaves focus nowhere
    // useful, so it takes focus itself rather than stranding a keyboard.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close packs" }),
    );

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps a close control even when its contents carry the heading", () => {
    // The library's heading changes with what it is filtered to, so it renders
    // its own and passes no header. The way out still has to be there, and
    // still has to be what takes focus.
    render(() => (
      <Dialog label="Library" size="jumbo" onClose={() => {}}>
        <h2>Loops</h2>
      </Dialog>
    ));

    const close = screen.getByRole("button", { name: "Close library" });
    expect(close).toBeVisible();
    expect(document.activeElement).toBe(close);
    expect(screen.getByRole("heading", { name: "Loops" })).toBeVisible();
  });
});
