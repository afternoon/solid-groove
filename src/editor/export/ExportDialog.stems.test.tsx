import { cleanup, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { StemExportError } from "../../export/stems/exportStems";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import ExportDialog, { failureMessage } from "./ExportDialog";
import type { exportStemsFile, StemsExportFile, StemsExportRequest } from "./stemsExport";

/** The Stems (ZIP) half of the Export dialog (EXP-003, CF-022). */

afterEach(cleanup);
stubCanvasContext();

const FILE: StemsExportFile = {
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" }),
  fileName: "Song 2026-09-29 stems.zip",
};

function pendingStems() {
  let resolve!: (file: StemsExportFile) => void;
  let reject!: (error: unknown) => void;
  const requests: StemsExportRequest[] = [];
  const exportStems = vi.fn((_project, request: StemsExportRequest) => {
    requests.push(request);
    return new Promise<StemsExportFile>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  }) as unknown as typeof exportStemsFile;
  return {
    exportStems,
    requests,
    resolve: (f = FILE) => resolve(f),
    reject: (e: unknown) => reject(e),
  };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function renderDialog(exportStems: typeof exportStemsFile) {
  const project = createSliceFixtureProject();
  const download = vi.fn();
  const exportWav = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      exportStems={exportStems}
      exportWav={exportWav as never}
      download={download}
      onClose={vi.fn()}
    />
  ));
  return { download, exportWav };
}

const radio = (name: string) => screen.getByRole("radio", { name });
const choose = (name: string) => clickAndFlush(radio(name));

describe("ExportDialog: Stems (ZIP)", () => {
  it("offers Stems (ZIP) at 24-bit, with no bit-depth choice", () => {
    renderDialog(pendingStems().exportStems);
    choose("Stems (ZIP)");
    expect(radio("Stems (ZIP)")).toBeChecked();
    expect(radio("Stereo WAV")).not.toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText(/One 24-bit WAV per track/)).toBeInTheDocument();
  });

  it("renders stems, downloads one ZIP and says it is done", async () => {
    const pending = pendingStems();
    const { download, exportWav } = renderDialog(pending.exportStems);
    choose("Stems (ZIP)");
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    expect(pending.requests).toHaveLength(1);
    pending.requests[0].onProgress?.(0.3);
    flush();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0.3");

    pending.resolve();
    await settle();
    expect(exportWav).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(FILE.blob, FILE.fileName);
    expect(screen.getByRole("status")).toHaveTextContent(/complete.*stems/i);
  });

  it("cancels, downloads nothing, and returns to the choice", async () => {
    const pending = pendingStems();
    const { download } = renderDialog(pending.exportStems);
    choose("Stems (ZIP)");
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    clickAndFlush(screen.getByRole("button", { name: "Cancel" }));
    expect(pending.requests[0].signal?.aborted).toBe(true);
    pending.reject(new StemExportError("aborted", "cancelled"));
    await settle();
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("says what to do when the stems are too large", async () => {
    const pending = pendingStems();
    const { download } = renderDialog(pending.exportStems);
    choose("Stems (ZIP)");
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    pending.reject(new StemExportError("quota_exceeded", "too large"));
    await settle();
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      failureMessage("quota_exceeded", "stems"),
    );
    expect(failureMessage("quota_exceeded", "stems")).toMatch(/2 GiB/);
  });
});
