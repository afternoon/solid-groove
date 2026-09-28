import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrumMachineFixtureProject } from "../domain/fixtures";
import type { AssetId } from "../domain/ids";
import SamplePicker from "./SamplePicker";

afterEach(() => cleanup());

const assets = createDrumMachineFixtureProject().song.assets.filter(
  (asset) => asset.kind === "sample",
);

function renderPicker(options: { current?: AssetId | null; browse?: () => void } = {}) {
  const onChoose = vi.fn();
  render(() => (
    <SamplePicker
      label="Sample for Kick"
      current={options.current === undefined ? assets[0].id : options.current}
      assets={assets}
      onChoose={onChoose}
      allowNone
      onBrowse={options.browse}
    />
  ));
  const button = screen.getByRole("button", { name: "Sample for Kick" });
  const openMenu = () => {
    fireEvent.click(button);
    flush();
  };
  return { onChoose, button, openMenu };
}

describe("SamplePicker (#447)", () => {
  it("names the loaded sound and lists the project's sounds when opened", () => {
    const { button, openMenu } = renderPicker();
    expect(button).toHaveTextContent(assets[0].name);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu();
    expect(button).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      ...assets.map((asset) => asset.name),
      "None",
    ]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
  });

  it("chooses a sound and closes", () => {
    const { onChoose, openMenu } = renderPicker();
    openMenu();
    fireEvent.click(screen.getAllByRole("menuitemradio")[1]);
    flush();
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(assets[1].id);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("empties the slot with None, and does nothing for the sound already loaded", () => {
    const { onChoose, openMenu } = renderPicker();
    openMenu();
    fireEvent.click(screen.getAllByRole("menuitemradio")[0]);
    flush();
    expect(onChoose).not.toHaveBeenCalled();
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "None" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("opens the library from the menu", () => {
    const browse = vi.fn();
    const { openMenu } = renderPicker({ browse });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse the library…" }));
    expect(browse).toHaveBeenCalledTimes(1);
  });

  it("closes on a press outside it, and on Escape through the shortcut registry", () => {
    const { openMenu } = renderPicker();
    openMenu();
    fireEvent.pointerDown(document.body);
    flush();
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    flush();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
