import { cleanup, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { StemExportError } from "../../export/stems/exportStems";
import { clickAndFlush } from "../../testing/events";
import ExportDialog, { failureMessage } from "./ExportDialog";
import type { exportStemsFile, StemsExportFile, StemsExportRequest } from "./stemsExport";

/** The Stems (ZIP) half of the Export dialog (EXP-003, CF-022). */

afterEach(cleanup);

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
  it("offers a bit depth only once Stems is chosen, with 24-bit chosen", () => {
    renderDialog(pendingStems().exportStems);
    expect(screen.queryByRole("radio", { name: "24-bit" })).toBeNull();
    choose("Stems (ZIP)");
    expect(radio("Stems (ZIP)")).toBeChecked();
    expect(radio("Stereo WAV")).not.toBeChecked();
    expect(radio("24-bit")).toBeChecked();
    expect(radio("16-bit")).not.toBeChecked();
    choose("Stereo WAV");
    expect(screen.queryByRole("radio", { name: "16-bit" })).toBeNull();
  });

  it("renders stems at 24-bit, downloads one ZIP and says it is done", async () => {
    const pending = pendingStems();
    const { download, exportWav } = renderDialog(pending.exportStems);
    choose("Stems (ZIP)");
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    expect(pending.requests.map((r) => r.bitDepth)).toEqual([24]);
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

  it("renders at 16-bit when chosen", () => {
    const pending = pendingStems();
    renderDialog(pending.exportStems);
    choose("Stems (ZIP)");
    choose("16-bit");
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    expect(pending.requests.map((r) => r.bitDepth)).toEqual([16]);
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
