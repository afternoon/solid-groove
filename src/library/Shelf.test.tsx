import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shelf, { allLabel } from "./Shelf";
import type { ShelfEntry, ShelfFamily } from "./shelf";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chosen = "kick";

function renderShelf(
  family: ShelfFamily = "drums",
  families: readonly ShelfEntry<ShelfFamily>[] = [
    { key: "drums", label: "Drums", count: 27 },
    { key: "fx", label: "FX", count: 4 },
  ],
) {
  render(() => (
    <Shelf
      families={families}
      family={family}
      roles={[
        { key: "kick", label: "Kick", count: 24 },
        { key: "snare", label: "Snare", count: 3 },
      ]}
      role={chosen}
      keyLabel={(action) => (action === "library.pick_all" ? "0" : "?")}
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

  it("draws one sound as '1 sound', like the list's own count (GRV-49)", () => {
    renderShelf("fx", [
      { key: "drums", label: "Drums", count: 27 },
      { key: "fx", label: "FX", count: 1 },
      { key: "loops", label: "Loops", count: 0 },
    ]);
    const unit = (name: RegExp) =>
      screen
        .getByRole("tab", { name })
        .querySelector(".shelf-family-count")
        ?.getAttribute("data-unit");

    expect(unit(/^FX/)).toBe("sound");
    expect(unit(/^Drums/)).toBe("sounds");
    expect(unit(/^Loops/)).toBe("sounds");
    // jsdom draws no `::after`, so pin that the stylesheet draws the tile's
    // word from that attribute rather than a fixed plural.
    const css = readFileSync(
      resolve(process.cwd(), "src/library/SoundsView.css"),
      "utf8",
    );
    const rule = css.match(/\.shelf-family-count::after\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/content:\s*" " attr\(data-unit\);/);
  });

  it("boxes All's key before its label, and gives a category no digit (UI-002)", () => {
    renderShelf();
    const all = screen.getByRole("button", { name: "All drums 27" });

    expect(all.firstElementChild).toHaveClass("library-modal-key");
    expect(all.firstElementChild).toHaveTextContent("0");
    expect(all).toHaveAttribute("aria-keyshortcuts", "0");
    const kick = screen.getByRole("button", { name: "Kick 24" });
    expect(kick).not.toHaveAttribute("aria-keyshortcuts");
    expect(kick.querySelector(".library-modal-key")).toBeNull();
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
