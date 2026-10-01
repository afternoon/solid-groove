import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import ExportDialog from "./ExportDialog";

/** The Release layout's title row and format cards (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

function renderDialog(exportWav = vi.fn(() => new Promise<never>(() => {}))) {
  const project = createSliceFixtureProject();
  render(() => (
    <ExportDialog
      project={() => project}
      exportWav={exportWav as never}
      download={vi.fn()}
      onClose={vi.fn()}
    />
  ));
  return { project, dialog: screen.getByRole("dialog", { name: "Export" }) };
}

describe("ExportDialog: the format cards", () => {
  it("are two real radios named exactly, Stereo WAV chosen on open", () => {
    renderDialog();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Stereo WAV",
      "Stems (ZIP)",
    ]);
    expect(screen.getByRole("radio", { name: "Stereo WAV" })).toBeChecked();
    // One radio group, so the arrow keys move between the cards natively.
    expect(new Set(radios.map((radio) => radio.getAttribute("name"))).size).toBe(1);
  });

  it("carry the design's copy, and the chosen card is marked", () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByText("Share a mix")).toBeVisible();
    expect(
      within(dialog).getByText(
        "One file of the song as you hear it. Ready to send or upload.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("Stems for hand off")).toBeVisible();
    expect(
      within(dialog).getByText(
        "One WAV per track, lined up at bar 1, for mixing in another DAW.",
      ),
    ).toBeVisible();
    const card = (name: string) =>
      screen.getByRole("radio", { name }).closest(".export-card");
    expect(card("Stereo WAV")).toHaveClass("checked");
    clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
    expect(card("Stereo WAV")).not.toHaveClass("checked");
    expect(card("Stems (ZIP)")).toHaveClass("checked");
  });

  it("are fixed while an export runs", () => {
    renderDialog();
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("radio", { name: "Stereo WAV" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Stems (ZIP)" })).toBeDisabled();
  });
});
