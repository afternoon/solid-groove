import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush } from "../testing/events";
import { libraryAsset as sound } from "./__fixtures__/assets";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import SimilarSoundsView from "./SimilarSoundsView";

afterEach(cleanup);

const url = "https://example.test/a.wav";
const ref = sound({ name: "Ref", role: "kick", genres: ["house"], url });
const near = sound({ name: "Near", role: "kick", genres: ["house"], url });
const far = sound({ name: "Far", role: "kick", genres: [], durationSeconds: 0.2, url });
const other = sound({ name: "Other", role: "snare", genres: [], url });
const library = [ref, near, far, other];

function renderView(over: Partial<Parameters<typeof SimilarSoundsView>[0]> = {}) {
  const engine = fakePreviewEngine();
  const props = { onSelect: vi.fn(), onBack: vi.fn() };
  render(() => (
    <SimilarSoundsView
      reference={ref}
      library={library}
      previewEngine={engine}
      backLabel="Kicks"
      {...props}
      {...over}
    />
  ));
  return { engine, ...props };
}

const list = () => screen.getByRole("list", { name: "Similar sounds" });
const names = () =>
  within(list())
    .getAllByRole("button", { name: /^Audition / })
    .map((b) => b.getAttribute("aria-label")?.replace("Audition ", ""));
const chip = (name: string) =>
  within(screen.getByRole("group", { name: "Match on" })).getByRole("button", { name });

describe("SimilarSoundsView", () => {
  it("names the reference and lists the family's closest sounds with a percentage", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Play Ref" })).toBeVisible();
    expect(names()).toEqual(["Near", "Far", "Other"]);
    expect(within(list()).getAllByRole("listitem")[0].textContent).toMatch(/\b100%/);
    for (const label of ["Category", "Genre", "Length"]) {
      expect(chip(label)).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.queryByRole("button", { name: "Character" })).toBeNull();
  });

  it("re-scores when a Match on chip is turned off", () => {
    renderView();
    const before = within(list()).getAllByRole("listitem")[1].textContent;
    clickAndFlush(chip("Genre"));
    expect(chip("Genre")).toHaveAttribute("aria-pressed", "false");
    expect(within(list()).getAllByRole("listitem")[1].textContent).not.toBe(before);
  });

  it("says so when every chip is off, rather than listing arbitrary matches", () => {
    renderView();
    for (const label of ["Category", "Genre", "Length"]) clickAndFlush(chip(label));
    expect(screen.queryByRole("list", { name: "Similar sounds" })).toBeNull();
    expect(screen.getByText(/Nothing to compare on/)).toBeVisible();
  });

  it("selects and auditions a clicked result", async () => {
    const { engine, onSelect } = renderView();
    clickAndFlush(screen.getByRole("button", { name: "Audition Near" }));
    expect(onSelect).toHaveBeenCalledWith(near);
    await Promise.resolve();
    expect(engine.starts.map((s) => s.asset)).toEqual([near]);
    expect(screen.getByRole("button", { name: "Audition Near" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hops on from a result, keeps a trail, and jumps back along it", () => {
    renderView();
    clickAndFlush(screen.getByRole("button", { name: "Sounds like Near" }));
    const trail = screen.getByRole("navigation", { name: "Similar sounds trail" });
    expect(
      within(trail)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Ref", "Near"]);
    expect(screen.getByRole("button", { name: "Play Near" })).toBeVisible();
    expect(names()).toContain("Ref");
    expect(names()).not.toContain("Near");

    clickAndFlush(within(trail).getByRole("button", { name: "Ref" }));
    expect(screen.getByRole("button", { name: "Play Ref" })).toBeVisible();
    expect(within(trail).getAllByRole("button")).toHaveLength(1);
  });

  it("goes back to the list it came from", () => {
    const { onBack } = renderView();
    clickAndFlush(screen.getByRole("button", { name: "Back to Kicks" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("plays the reference and stops when it unmounts", async () => {
    const { engine } = renderView();
    clickAndFlush(screen.getByRole("button", { name: "Play Ref" }));
    await Promise.resolve();
    expect(engine.starts).toHaveLength(1);
    cleanup();
    expect(engine.starts[0].stop).toHaveBeenCalled();
  });
});
