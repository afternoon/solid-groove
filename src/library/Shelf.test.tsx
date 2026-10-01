import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shelf, { allLabel } from "./Shelf";
import type { ShelfFamily } from "./shelf";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chosen = "kick";

function renderShelf(family: ShelfFamily = "drums") {
  render(() => (
    <Shelf
      families={[
        { key: "drums", label: "Drums", count: 27 },
        { key: "fx", label: "FX", count: 4 },
      ]}
      family={family}
      roles={[
        { key: "kick", label: "Kick", count: 24 },
        { key: "snare", label: "Snare", count: 3 },
      ]}
      role={chosen}
      keyLabel={(action) => (action === "library.pick_all" ? "0" : action.slice(-1))}
      onFamily={() => {}}
      onRole={() => {}}
    />
  ));
}

/** Pretend the chip row is narrower than its chips, as a long family's is. */
function overflowing(): void {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
}

describe("Shelf (LIB-010)", () => {
  it("draws a family as a tile: its name over its count", () => {
    renderShelf();
    const tile = screen.getByRole("tab", { name: /^Drums/ });

    expect(tile.querySelector(".shelf-family-name")).toHaveTextContent("Drums");
    expect(tile.querySelector(".shelf-family-count")).toHaveTextContent("27");
    expect(tile).toHaveAttribute("aria-selected", "true");
  });

  it("boxes each chip's key before its label, out of the accessible name", () => {
    renderShelf();
    const kick = screen.getByRole("button", { name: "Kick 24" });

    expect(kick.firstElementChild).toHaveClass("library-modal-key");
    expect(kick.firstElementChild).toHaveTextContent("1");
    expect(kick).toHaveAttribute("aria-keyshortcuts", "1");
    expect(screen.getByRole("button", { name: "All drums 27" })).toHaveAttribute(
      "aria-keyshortcuts",
      "0",
    );
  });

  it("names All in sentence case, keeping an acronym's capitals", () => {
    expect(allLabel("drums")).toBe("All drums");
    expect(allLabel("fx")).toBe("All FX");
  });

  it("hides the scroll arrows while every chip fits", () => {
    renderShelf();

    expect(screen.queryByRole("button", { name: /^Scroll categories/ })).toBeNull();
    expect(document.querySelector(".shelf-chips")).not.toHaveClass(
      "shelf-chips-overflow",
    );
  });

  it("shows the scroll arrows and the edge fade when the chips overflow", () => {
    overflowing();
    renderShelf();

    expect(screen.getByRole("button", { name: "Scroll categories left" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeVisible();
    expect(document.querySelector(".shelf-chips")).toHaveClass("shelf-chips-overflow");
  });
});
