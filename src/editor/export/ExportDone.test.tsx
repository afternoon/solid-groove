import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import ExportDone from "./ExportDone";
import type { FinishedExport } from "./finishedExport";

/** The finished screen: copy, readouts, the ZIP list and the two actions (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

const finished = (over: Partial<FinishedExport> = {}): FinishedExport => ({
  name: "Night Drive",
  tempo: "120 BPM",
  length: "2:30",
  format: "stereo",
  fileName: "Night Drive 2026-09-30.wav",
  zips: [],
  count: 5,
  size: "40 MiB",
  bars: 64,
  stripes: [{ color: "#ff0000", lanes: [{ startBar: 0, lengthBars: 4 }] }],
  ...over,
});

function renderDone(over: Partial<FinishedExport> = {}) {
  const onBack = vi.fn();
  const onAgain = vi.fn();
  render(() => (
    <ExportDone finished={finished(over)} onBack={onBack} onAgain={onAgain} />
  ));
  return { onBack, onAgain };
}

const readout = (label: string) => screen.getByText(label).parentElement;
const stems = {
  format: "stems" as const,
  fileName: "Night Drive 2026-09-30 stems.zip",
};

describe("ExportDone", () => {
  it("announces completion as the one live status, and the song as out", () => {
    renderDone();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Export complete");
    expect(screen.getAllByText(/\b(done|complete|finished)\b/i)).toEqual([status]);
    expect(screen.getByRole("heading", { name: "Night Drive is out." })).toBeVisible();
  });

  it("says where a stereo mix is, and reads Length, Tracks in the mix, Size and Bars", () => {
    renderDone();
    expect(
      screen.getByText(
        "Night Drive 2026-09-30.wav is in your downloads. Send it to anyone. It plays everywhere.",
      ),
    ).toBeVisible();
    expect(readout("Length")).toHaveTextContent("2:30");
    expect(readout("Tracks in the mix")).toHaveTextContent("5");
    expect(readout("Size")).toHaveTextContent("40 MiB");
    expect(readout("Bars")).toHaveTextContent("64");
    expect(screen.queryByRole("list", { name: "ZIPs" })).toBeNull();
  });

  it("says where one ZIP of stems is, and counts Stems", () => {
    renderDone(stems);
    expect(
      screen.getByText(
        "Night Drive 2026-09-30 stems.zip is in your downloads. Drop the folder into any DAW. Every stem starts at bar 1, so they line up.",
      ),
    ).toBeVisible();
    expect(readout("Stems")).toHaveTextContent("5");
  });

  it("lists several ZIPs with their sizes and counts them instead of the bars", () => {
    renderDone({
      ...stems,
      zips: [
        { name: "Night Drive 2026-09-30 stems 1 of 2.zip", size: "1.96 GiB" },
        { name: "Night Drive 2026-09-30 stems 2 of 2.zip", size: "1.50 GiB" },
      ],
    });
    expect(
      screen.getByText(
        "2 ZIPs are in your downloads. Unzip them into one folder and drop it into any DAW. Every stem starts at bar 1, so they line up.",
      ),
    ).toBeVisible();
    expect(readout("ZIPs")).toHaveTextContent("2");
    expect(screen.queryByText("Bars")).toBeNull();
    const items = within(screen.getByRole("list", { name: "ZIPs" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "✓Night Drive 2026-09-30 stems 1 of 2.zip1.96 GiB",
      "✓Night Drive 2026-09-30 stems 2 of 2.zip1.50 GiB",
    ]);
  });

  it("makes Back to the song the focused primary, beside the other format's export", () => {
    const { onBack, onAgain } = renderDone();
    const back = screen.getByRole("button", { name: "Back to the song" });
    expect(back).toHaveFocus();
    expect(back).toHaveClass("export-primary");
    clickAndFlush(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    clickAndFlush(screen.getByRole("button", { name: "Export stems too" }));
    expect(onAgain).toHaveBeenCalledTimes(1);
  });

  it("offers a mix after stems, and promises the project is untouched", () => {
    renderDone(stems);
    expect(screen.getByRole("button", { name: "Export a mix too" })).toBeVisible();
    expect(screen.getByText("It's still your project.")).toBeVisible();
  });
});
