import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import type { Project } from "../../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../../domain/fixtures";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import { downloadCards } from "./downloadCards";
import ExportDialog from "./ExportDialog";
import { exportFileName } from "./exportFileName";
import { stemsBatchFileName } from "./stemsExport";
import type { StereoExportOptions } from "./stereoExport";

/** The Downloads row: one card per file, with the state the export has reached (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function renderDialog(project: Project = createSliceFixtureProject()) {
  let options: StereoExportOptions | undefined;
  let reject!: (error: unknown) => void;
  const exportWav = vi.fn((_p: Project, given?: StereoExportOptions) => {
    options = given;
    return new Promise((_resolve, rej) => {
      reject = rej;
    });
  });
  render(() => (
    <ExportDialog
      project={() => project}
      exportWav={exportWav as never}
      download={vi.fn()}
      onClose={vi.fn()}
    />
  ));
  return {
    project,
    progress: (fraction: number) => {
      options?.onProgress?.(fraction);
      flush();
    },
    fail: async () => {
      reject(new OfflineRenderError("decode_failed", "bad asset"));
      await settle();
    },
  };
}

const row = () => screen.getByRole("region", { name: "Downloads" });
const cards = () => [...row().querySelectorAll<HTMLElement>(".download")];

describe("ExportDialog: the Downloads row", () => {
  it("is always there, and lists the stereo WAV by its file name with its size", () => {
    const { project } = renderDialog();
    expect(within(row()).getByText("Downloads")).toBeVisible();
    expect(cards()).toHaveLength(1);
    const name = exportFileName(project.metadata.name, new Date(), "wav");
    expect(within(cards()[0]).getByText(name)).toBeVisible();
    expect(cards()[0]).toHaveTextContent(/1 file · \d+ MiB/);
    expect(cards()[0]).toHaveTextContent("Waiting");
  });

  it("lists the ZIP for the stems selection, with its file count", () => {
    const { project } = renderDialog();
    clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
    const name = stemsBatchFileName(project.metadata.name, new Date(), 0, 1);
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText(name)).toBeVisible();
    // The track's stem and the reference mix.
    expect(cards()[0]).toHaveTextContent(/[23] files · \d+ MiB/);
  });

  it("follows the export: printing, then downloaded, or failed", async () => {
    const view = renderDialog();
    clickAndFlush(screen.getByRole("button", { name: "Export" }));
    view.progress(0.4);
    expect(cards()[0]).toHaveTextContent("Printing 40%");
    expect(cards()[0].querySelector("i")).toHaveStyle({ width: "40%" });
    await view.fail();
    expect(cards()[0]).toHaveTextContent("Failed");
    expect(cards()[0]).toHaveClass("bad");
  });

  it("splits an over-budget selection into numbered ZIPs, each named on hover", () => {
    renderDialog(createReferenceProject());
    clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
    expect(cards().length).toBeGreaterThan(1);
    const first = cards()[0].querySelector("b");
    expect(first).toHaveTextContent(`ZIP 1 of ${cards().length}`);
    expect(first?.getAttribute("title")).toMatch(/ stems 1 of \d+\.zip$/);
  });
});

describe("downloadCards", () => {
  const base = {
    format: "stereo" as const,
    projectName: "Song",
    date: new Date(2026, 8, 30),
    batches: [],
    stereoBytes: 300 * 1024 ** 2,
    fraction: 0.5,
  };

  it("fills a finished file's line and leaves the other ZIPs waiting", () => {
    expect(downloadCards({ ...base, state: "done" })[0]).toMatchObject({
      name: "Song 2026-09-30.wav",
      detail: "1 file · 300 MiB",
      state: "done",
      fraction: 1,
    });
    const zipPlan = (index: number) => ({
      index,
      paths: ["a.wav", "b.wav"],
      hasMix: index === 0,
      trackIds: [],
      bytes: 10 * 1024 ** 2,
      fits: true,
    });
    const zips = downloadCards({
      ...base,
      format: "stems",
      batches: [zipPlan(0), zipPlan(1)],
      state: "now",
    });
    expect(zips.map((zip) => [zip.name, zip.state, zip.fraction])).toEqual([
      ["ZIP 1 of 2", "now", 0.5],
      ["ZIP 2 of 2", "waiting", 0],
    ]);
  });
});
