import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush } from "../testing/events";
import { libraryAsset as sound } from "./__fixtures__/assets";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import SimilarSoundsView from "./SimilarSoundsView";
import type { SoundsKeyAction } from "./soundKeys";

afterEach(cleanup);

const url = "https://example.test/a.wav";
const ref = sound({ name: "Ref", role: "kick", genres: ["house"], url });
const near = sound({ name: "Near", role: "kick", genres: ["house"], url });
const far = sound({ name: "Far", role: "kick", genres: [], durationSeconds: 0.2, url });
const other = sound({ name: "Other", role: "snare", genres: [], url });
const library = [ref, near, far, other];

function renderView(over: Partial<Parameters<typeof SimilarSoundsView>[0]> = {}) {
  const engine = fakePreviewEngine();
  let keys: ((action: SoundsKeyAction) => void) | null = null;
  const onKeys = vi.fn((handler: ((action: SoundsKeyAction) => void) | null) => {
    keys = handler;
  });
  const props = { onSelect: vi.fn(), onBack: vi.fn(), onKeys };
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
  const press = (action: SoundsKeyAction) => {
    keys?.(action);
    flush();
  };
  return { engine, press, ...props };
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

  it("walks the results with the arrows, selecting and auditioning each (#873)", async () => {
    const { engine, onSelect, press } = renderView();
    press("library.select_next");
    press("library.select_next");
    expect(onSelect.mock.calls.map(([asset]) => asset)).toEqual([near, far]);
    expect(screen.getByRole("button", { name: "Audition Far" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    press("library.select_next");
    press("library.select_next");
    press("library.select_previous");
    expect(onSelect.mock.calls.map(([asset]) => asset)).toEqual([near, far, other, far]);
    await Promise.resolve();
    expect(engine.starts.map((s) => s.asset)).toEqual([near, far, other, far]);
  });

  it("auditions the selection again on Space, and the reference before there is one", async () => {
    const { engine, press } = renderView();
    press("library.audition");
    await Promise.resolve();
    expect(engine.starts.map((s) => s.asset)).toEqual([ref]);
    clickAndFlush(screen.getByRole("button", { name: "Audition Near" }));
    press("library.audition");
    await Promise.resolve();
    expect(engine.starts.map((s) => s.asset)).toEqual([ref, near, near]);
  });

  it("hops on from the selected result with S, growing the trail", () => {
    const { press } = renderView();
    const crumbs = () =>
      within(screen.getByRole("navigation", { name: "Similar sounds trail" }))
        .getAllByRole("button")
        .map((b) => b.textContent);
    press("library.similar");
    expect(crumbs()).toEqual(["Ref"]);
    clickAndFlush(screen.getByRole("button", { name: "Audition Far" }));
    press("library.select_previous");
    press("library.similar");
    expect(crumbs()).toEqual(["Ref", "Near"]);
    expect(screen.getByRole("button", { name: "Play Near" })).toBeVisible();
  });

  it("hands the host its key handler and takes it back when it unmounts", () => {
    const { onKeys } = renderView();
    expect(onKeys).toHaveBeenLastCalledWith(expect.any(Function));
    cleanup();
    expect(onKeys).toHaveBeenLastCalledWith(null);
  });

  it("goes back to the list it came from", () => {
    const { onBack } = renderView();
    const back = screen.getByRole("button", { name: "Back to Kicks" });
    expect(back).toHaveTextContent(/^Kicks$/);
    expect(back.querySelector("svg")).not.toBeNull();
    clickAndFlush(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("reads plain Back when the host names no list", () => {
    renderView({ backLabel: undefined });
    expect(screen.getByRole("button", { name: "Back" })).toHaveTextContent(/^Back$/);
  });

  it("labels role and length as the sound rows do", () => {
    const tagged = sound({
      name: "Tagged",
      role: "closed-hat",
      characters: ["tight"],
      durationSeconds: 0.42,
      packName: "Pack B",
      url,
    });
    renderView({ reference: tagged, library: [tagged, near] });
    expect(screen.getByText("Pack B · Closed hat · tight · 0.42 s")).toBeVisible();
    const row = within(list()).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("Pack A · Kick");
    expect(row).toHaveTextContent("1.00 s");
  });

  it("gives every result the sound row's actions and a match meter", () => {
    renderView();
    const row = within(list()).getAllByRole("listitem")[0];
    for (const name of ["Audition Near", "Favourite Near", "Sounds like Near"]) {
      expect(within(row).getByRole("button", { name })).toBeInTheDocument();
    }
    const meter = row.querySelector(".similar-match");
    expect(meter).toHaveTextContent(/^100%$/);
    expect(meter).toHaveAttribute("title", "100% match");
    expect(meter?.querySelector(".similar-meter-fill")).toHaveStyle({ width: "100%" });
    const second = within(list()).getAllByRole("listitem")[1];
    const percent = second.textContent?.match(/(\d{1,3})%/)?.[1];
    expect(second.querySelector(".similar-meter-fill")).toHaveStyle({
      width: `${percent}%`,
    });
    expect(row.querySelector(".sound-row-tags")).toBeNull();
  });

  it("counts the results and says how to hop on", () => {
    renderView();
    expect(
      screen.getByText(
        /^3 closest from every pack · on a result hops to its neighbours$/,
      ),
    ).toBeVisible();
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
