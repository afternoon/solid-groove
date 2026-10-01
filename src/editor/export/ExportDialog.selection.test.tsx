import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../domain/entities";
import { createReferenceProject } from "../../domain/fixtures";
import { createStemFixtureProject } from "../../export/stems/stemFixture";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import { fakeStemsBatch } from "../../testing/stemsBatchFake";
import ExportDialog from "./ExportDialog";
import { formatBytes, stemsBlocker } from "./stemSelection";
import type { StemsBatchRequest } from "./stemsExport";

/** The stems dialog's track selection and size budget (EXP-003, #66), now made on
 * the track list's rows rather than on checkboxes (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

function renderDialog(project: Project) {
  const fake = fakeStemsBatch();
  const requests: StemsBatchRequest[] = [];
  const download = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      exportStemsBatch={
        ((p: Project, request: StemsBatchRequest) => {
          requests.push(request);
          return fake.exportStemsBatch(p, request);
        }) as never
      }
      download={download}
      onClose={vi.fn()}
    />
  ));
  clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
  return { requests, download };
}

const exportButton = () => screen.getByRole("button", { name: "Export" });
/** Blocked, Export stays focusable, so its reason is read out, and does nothing. */
function expectBlocked(requests: StemsBatchRequest[]) {
  const button = exportButton();
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).not.toBeDisabled();
  button.focus();
  expect(button).toHaveFocus();
  clickAndFlush(button);
  expect(requests).toEqual([]);
}
/** A track's row: its name is `<name>, included` or `<name>, left out`. */
const row = (name: string) =>
  screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-label")?.startsWith(`${name}, `)) as
    | HTMLElement
    | undefined;
const toggle = (name: string) => clickAndFlush(row(name) as HTMLElement);
const isOn = (name: string) =>
  row(name)?.getAttribute("aria-label")?.endsWith(", included");
const ordered = (project: Project) =>
  [...project.song.tracks].sort((a, b) => a.order - b.order);

describe("ExportDialog: choosing the tracks in a stem export", () => {
  it("includes every track by default, and exports them all", async () => {
    const project = createStemFixtureProject();
    const { requests } = renderDialog(project);
    const tracks = ordered(project);
    for (const track of tracks) expect(isOn(track.name)).toBe(true);
    clickAndFlush(exportButton());
    expect(requests.map((r) => r.trackIds)).toEqual([tracks.map((track) => track.id)]);
  });

  it("exports only the tracks left included", async () => {
    const project = createStemFixtureProject();
    const { requests } = renderDialog(project);
    const [lead, bass] = ordered(project);
    toggle(lead.name);
    expect(isOn(lead.name)).toBe(false);
    clickAndFlush(exportButton());
    expect(requests.map((r) => r.trackIds)).toEqual([[bass.id]]);
  });

  it("blocks Export with no track selected", () => {
    const project = createStemFixtureProject();
    const { requests } = renderDialog(project);
    // The reason's live region is there, empty, before anything blocks Export.
    const region = document.getElementById("export-stems-blocker");
    expect(region).toBeEmptyDOMElement();
    for (const track of ordered(project)) toggle(track.name);
    expectBlocked(requests);
    expect(document.getElementById("export-stems-blocker")).toBe(region);
    expect(region).toHaveTextContent("Select at least one track to export.");
    expect(screen.getByText("Select at least one track to export.")).toBeVisible();
  });

  describe("with the PRD reference project (50 tracks, ten minutes, 44.1 kHz)", () => {
    const project = createReferenceProject();
    const tracks = ordered(project);

    // One option per track, in track order: queried once, because a role
    // query over fifty of them is slow in jsdom.
    const turnOff = (rows: HTMLElement[]) => {
      for (const option of rows) clickAndFlush(option);
    };
    const trackRows = () => screen.getAllByRole("option").slice(0, 50);

    it("shows the size, which shrinks as tracks are left out", () => {
      renderDialog(project);
      const size = () => screen.getByText("Size").nextElementSibling?.textContent;
      expect(size()).toBe("7.82 GiB \u00b7 51 files");
      turnOff(trackRows().slice(0, 1));
      expect(size()).toBe("7.66 GiB \u00b7 50 files");
    });

    it("blocks Export over the budget, names the limit, and exports once under it", () => {
      const { requests } = renderDialog(project);
      const rows = trackRows();
      expect(rows).toHaveLength(50);
      expectBlocked(requests);
      const reason = () => document.getElementById("export-stems-blocker");
      // One live region, mounted throughout: only what it says changes.
      const region = reason();
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(reason()).toHaveTextContent(/over the 2 GiB limit/);
      expect(reason()).toHaveTextContent(/Deselect tracks/);
      expect(exportButton()).toHaveAttribute("aria-describedby", "export-stems-blocker");
      // 13 tracks do not fit; 12 do.
      turnOff(rows.slice(13));
      expect(reason()).toHaveTextContent(/over the 2 GiB limit/);
      turnOff(rows.slice(12, 13));
      expect(reason()).toBe(region);
      expect(region).toBeEmptyDOMElement();
      expect(exportButton()).not.toHaveAttribute("aria-disabled");
      expect(exportButton()).not.toHaveAttribute("aria-describedby");
      clickAndFlush(exportButton());
      expect(requests.map((r) => r.trackIds)).toEqual([
        tracks.slice(0, 12).map((track) => track.id),
      ]);
    });
  });
});

describe("stemsBlocker", () => {
  const estimate = { bytes: 3 * 1024 ** 3, limitBytes: 2 * 1024 ** 3, fits: false };

  it("says nothing while the selection fits", () => {
    expect(stemsBlocker(3, { ...estimate, fits: true })).toBeNull();
  });

  it("names the size and the limit", () => {
    expect(stemsBlocker(3, estimate)).toBe(
      "This selection is about 3 GiB, over the 2 GiB limit for an export in the browser. Deselect tracks to get under it.",
    );
  });

  it("formats sizes in binary units", () => {
    expect(formatBytes(512)).toBe("1 MiB");
    expect(formatBytes(300 * 1024 ** 2)).toBe("300 MiB");
    expect(formatBytes(1.25 * 1024 ** 3)).toBe("1.25 GiB");
    // Two decimals, so a ZIP under the limit never rounds up to it.
    expect(formatBytes(1.96 * 1024 ** 3)).toBe("1.96 GiB");
    expect(formatBytes(4.57 * 1024 ** 3)).toBe("4.57 GiB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GiB");
  });
});
