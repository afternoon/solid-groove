import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../domain/entities";
import { createReferenceProject } from "../../domain/fixtures";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import ExportDialog from "./ExportDialog";
import type { exportStemsFile, StemsExportRequest } from "./stemsExport";

/** The track list mounted in the dialog: selection, keys and Escape (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

// Ten tracks, enough to click a range; returns follow them as fixed rows.
const project: Project = createReferenceProject({
  trackCount: 10,
  minutes: 1,
  placementCount: 10,
});

function renderDialog() {
  const requests: StemsExportRequest[] = [];
  const exportStems = vi.fn(async (_p: Project, request: StemsExportRequest) => {
    requests.push(request);
    return { blob: new Blob([]), fileName: "stems.zip" };
  }) as unknown as typeof exportStemsFile;
  const onClose = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      exportStems={exportStems}
      download={vi.fn()}
      onClose={onClose}
    />
  ));
  return { requests, onClose };
}

const click = (element: Element, init: MouseEventInit = {}) =>
  fireAndFlush(() => fireEvent.click(element, init));
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireAndFlush(() => fireEvent.keyDown(window, { key, ...init }));
const focusList = () => fireAndFlush(() => listbox().focus());
const stems = () => clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
const options = () => screen.getAllByRole("option");
const left = () =>
  options().filter((option) => option.getAttribute("aria-label")?.endsWith("left out"));
const picked = () => options().filter((o) => o.getAttribute("aria-selected") === "true");
const listbox = () => screen.getByRole("listbox", { name: "Tracks to export" });

describe("ExportDialog: the track list", () => {
  it("is read-only in stereo: every row is in the mix and a click changes nothing", () => {
    renderDialog();
    expect(listbox()).toBeVisible();
    expect(options().length).toBeGreaterThanOrEqual(10);
    expect(options()[0]).toHaveAttribute("aria-disabled", "true");
    expect(options()[0]).toHaveAccessibleName(/in the mix|muted/);
    clickAndFlush(options()[0]);
    expect(left()).toHaveLength(0);
  });

  it("starts the keyboard on the first row, as a listbox does", () => {
    renderDialog();
    expect(listbox()).toHaveAttribute("aria-activedescendant", options()[0].id);
  });

  it("flips a row on a click, and a run of rows on a shift-click", () => {
    const { requests } = renderDialog();
    stems();
    clickAndFlush(options()[1]);
    expect(left()).toHaveLength(1);
    click(options()[4], { shiftKey: true });
    // Shift-click sets every row between to match the anchor's new state.
    expect(left()).toHaveLength(4);
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    expect(requests[0].trackIds).toHaveLength(6);
  });

  it("picks rows on a meta-click, and a click on a picked row flips them all", () => {
    renderDialog();
    stems();
    click(options()[2], { ctrlKey: true });
    click(options()[5], { ctrlKey: true });
    expect(picked()).toHaveLength(2);
    expect(screen.getByText("2 picked")).toBeVisible();
    expect(left()).toHaveLength(0);
    clickAndFlush(options()[5]);
    expect(left()).toHaveLength(2);
  });

  it("takes a click on a lane as a click on its row", () => {
    renderDialog();
    stems();
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    click(canvas, { clientY: 24 * 3 + 5 });
    expect(left()).toHaveLength(1);
    expect(left()[0]).toBe(options()[3]);
  });

  it("drops the picks when the format changes, so stereo shows none", () => {
    renderDialog();
    stems();
    click(options()[2], { ctrlKey: true });
    expect(picked()).toHaveLength(1);
    clickAndFlush(screen.getByRole("radio", { name: "Stereo WAV" }));
    expect(picked()).toHaveLength(0);
  });

  it("clears the picks on Escape before it closes", () => {
    const { onClose } = renderDialog();
    stems();
    click(options()[2], { ctrlKey: true });
    expect(picked()).toHaveLength(1);
    press("Escape");
    expect(picked()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape in stereo, where the list holds nothing to clear", () => {
    const { onClose } = renderDialog();
    stems();
    click(options()[2], { ctrlKey: true });
    clickAndFlush(screen.getByRole("radio", { name: "Stereo WAV" }));
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ExportDialog: the track list's keys", () => {
  it("move, flip and pick while the list has focus", () => {
    renderDialog();
    stems();
    focusList();
    const active = () => listbox().getAttribute("aria-activedescendant");
    press("ArrowDown");
    const first = active();
    expect(first).toBe(options()[1].id);
    press("ArrowDown");
    expect(active()).toBe(options()[2].id);
    press("ArrowUp");
    expect(active()).toBe(first);

    press(" ");
    expect(left()).toEqual([options()[1]]);
    press("Enter");
    expect(left()).toHaveLength(0);

    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(picked()).toHaveLength(3);
    press("a", { ctrlKey: true });
    expect(picked().length).toBe(options().length);
  });

  it("do nothing until the list has focus, nor in stereo", () => {
    renderDialog();
    stems();
    press(" ");
    press("ArrowDown");
    expect(left()).toHaveLength(0);
    expect(listbox()).toHaveAttribute("aria-activedescendant", options()[0].id);

    clickAndFlush(screen.getByRole("radio", { name: "Stereo WAV" }));
    focusList();
    press("ArrowDown");
    press(" ");
    expect(listbox()).toHaveAttribute("aria-activedescendant", options()[0].id);
    expect(left()).toHaveLength(0);
  });
});
