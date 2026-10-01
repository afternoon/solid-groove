import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { clickAndFlush } from "../../testing/events";
import ExportDialog from "./ExportDialog";
import { exportFacts, formatLength, formatQuality, formatTempo } from "./exportFacts";

/** The Release layout's title row and format cards (EXP-004). */

afterEach(cleanup);

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

describe("exportFacts", () => {
  it("writes a length as m:ss, rounding once", () => {
    expect(formatLength(0)).toBe("0:00");
    expect(formatLength(61.4)).toBe("1:01");
    expect(formatLength(59.6)).toBe("1:00");
    expect(formatLength(600)).toBe("10:00");
  });

  it("writes the tempo and the project's own sample rate", () => {
    expect(formatTempo(124)).toBe("124 BPM");
    expect(formatTempo(120.5)).toBe("120.5 BPM");
    expect(formatQuality(48_000)).toBe("24-bit · 48 kHz");
    expect(formatQuality(44_100)).toBe("24-bit · 44.1 kHz");
  });
});

describe("ExportDialog: the title row", () => {
  it("names the song under an EXPORT eyebrow, with its facts as readouts", () => {
    const { project, dialog } = renderDialog();
    const facts = exportFacts(project);
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(
      project.metadata.name,
    );
    expect(
      within(dialog).getByText("Export", { selector: ".export-eyebrow" }),
    ).toBeVisible();
    const readout = (label: string) =>
      screen.getByText(label, { selector: ".export-label" }).nextElementSibling;
    expect(readout("Length")).toHaveTextContent(facts.length);
    expect(readout("Tempo")).toHaveTextContent(facts.tempo);
    expect(readout("Tracks")).toHaveTextContent(String(project.song.tracks.length));
    expect(readout("Quality")).toHaveTextContent(facts.quality);
    expect(facts.quality).toMatch(/^24-bit · \d+(\.\d)? kHz$/);
  });

  it("keeps a close control named for the dialog", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Close export" })).toBeVisible();
  });
});
