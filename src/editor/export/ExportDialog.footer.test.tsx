import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import type { Project } from "../../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../../domain/fixtures";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import ExportDialog, { failureMessage } from "./ExportDialog";
import type { StereoExportOptions } from "./stereoExport";

/** The footer: readouts, actions and the one-line message slot (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

function renderDialog(project: Project = createSliceFixtureProject()) {
  let options: StereoExportOptions | undefined;
  let reject!: (error: unknown) => void;
  const exportWav = vi.fn((_p: Project, given?: StereoExportOptions) => {
    options = given;
    return new Promise((_resolve, rej) => {
      reject = rej;
    });
  });
  const onClose = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      exportWav={exportWav as never}
      download={vi.fn()}
      onClose={onClose}
    />
  ));
  return {
    onClose,
    progress: (fraction: number) => {
      options?.onProgress?.(fraction);
      flush();
    },
    fail: async () => {
      reject(new OfflineRenderError("decode_failed", "bad asset"));
      await Promise.resolve();
      await Promise.resolve();
      flush();
    },
  };
}

const footer = () => document.querySelector(".export-footer") as HTMLElement;
const readout = (label: string) =>
  within(footer()).getByText(label, { selector: ".export-label" }).parentElement;
const stems = () => clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));

describe("ExportDialog: the footer readouts", () => {
  it("reads the stereo WAV's size and the stems' size, file count and ZIP count", () => {
    renderDialog();
    expect(readout("Size")).toHaveTextContent(/^Size\d+ MiB \u00b7 1 file$/);
    expect(readout("Level")).toHaveTextContent("Project level, not normalized");
    stems();
    expect(readout("Size")).toHaveTextContent(/\d+ MiB \u00b7 [23] files/);
    expect(readout("Downloads")).toHaveTextContent("1 ZIP");
  });

  it("says how many ZIPs an over-budget selection comes as", () => {
    renderDialog(createReferenceProject());
    stems();
    expect(readout("Downloads")?.textContent).toMatch(/\d+ ZIPs, each under 2 GiB$/);
  });

  it("swaps to what is printing with Cancel alone while it renders", () => {
    const view = renderDialog();
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    view.progress(0.5);
    expect(readout("Printing")?.textContent).toMatch(/^Printingbar \d+ of \d+$/);
    expect(
      within(footer()).getByRole("progressbar", { name: "Export progress" }),
    ).toBeVisible();
    expect(within(footer()).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(within(footer()).queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("ExportDialog: the actions", () => {
  it("offers a secondary Close beside the one primary Export", () => {
    const { onClose } = renderDialog();
    const primary = screen.getByRole("button", { name: "Export" });
    expect(primary).toHaveClass("export-primary");
    expect(primary).toHaveTextContent("Export");
    clickAndFlush(within(footer()).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ExportDialog: the message slot", () => {
  it("keeps its alert mounted and empty, and fills it with a failure", async () => {
    const view = renderDialog();
    const alert = screen.getByRole("alert");
    expect(alert).toBeEmptyDOMElement();
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    await view.fail();
    expect(screen.getByRole("alert")).toBe(alert);
    expect(alert).toHaveTextContent(failureMessage("decode_failed"));
    expect(alert).toHaveClass("shown");
  });

  it("says why Export is off in its one-line note, which stays one live region", () => {
    renderDialog();
    stems();
    const note = document.getElementById("export-note") as HTMLElement;
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).toHaveTextContent(/These fit in one/);
    clickAndFlush(screen.getAllByRole("option")[0]);
    expect(document.getElementById("export-note")).toBe(note);
    expect(note).toHaveTextContent("Turn on at least one track to export stems.");
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute(
      "aria-describedby",
      "export-note",
    );
  });
});
