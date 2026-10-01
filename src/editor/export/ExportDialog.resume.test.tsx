import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Analytics } from "../../analytics/analytics";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import type { Project } from "../../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../../domain/fixtures";
import { StemExportError } from "../../export/stems/exportStems";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import { fakeStemsBatch, settle } from "../../testing/stemsBatchFake";
import ExportDialog from "./ExportDialog";
import { stoppedNote, zipFailure } from "./exportNotes";
import type { StemsBatchRequest } from "./stemsExport";

/** Cancel and failure keep the finished ZIPs and offer to resume (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

/** The engine's analytics, as far as the dialog can affect them: the trio is
 * logged by the ZIPs themselves, started on the first and completed on the last. */
function loggingFake(log: (event: string, payload: object) => void) {
  const fake = fakeStemsBatch();
  const exportStemsBatch = ((p: Project, request: StemsBatchRequest) => {
    const { index } = request.batch;
    if (index === 0) {
      log("export_started", { export_type: "stems", zip_count: request.count });
    }
    if (request.signal?.aborted) {
      log("export_failed", { export_type: "stems", was_cancelled: true });
      return Promise.reject(new StemExportError("aborted", "cancelled"));
    }
    return fake.exportStemsBatch(p, request).then(
      (file) => {
        if (index === request.count - 1) {
          log("export_completed", {
            export_type: "stems",
            zip_count: request.count,
          });
        }
        return file;
      },
      (error) => {
        log("export_failed", { export_type: "stems" });
        throw error;
      },
    );
  }) as typeof fake.exportStemsBatch;
  return { calls: fake.calls, exportStemsBatch };
}

function renderDialog(project: Project = createReferenceProject()) {
  const log = vi.fn();
  const analytics = { log } as unknown as Analytics;
  const fake = loggingFake(log);
  const download = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      analytics={analytics}
      exportStemsBatch={fake.exportStemsBatch}
      download={download}
      onClose={vi.fn()}
    />
  ));
  clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
  const count = document.querySelectorAll(".download").length;
  const events = () => log.mock.calls.map((call) => call[0]);
  return { ...fake, download, count, events, log };
}

const primary = () => document.querySelector(".export-primary") as HTMLElement;
const note = () => document.getElementById("export-note");
const alert = () => screen.getByRole("alert");
const states = () =>
  [...document.querySelectorAll(".download-state")].map((state) => state.textContent);
const cancel = () => clickAndFlush(screen.getByRole("button", { name: "Cancel" }));
const aborted = () => new StemExportError("aborted", "cancelled");

describe("ExportDialog: cancelling a batched export", () => {
  it("keeps the finished ZIP, says so, and resumes from the next one", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    await view.calls[0].resolve();
    cancel();
    await view.calls[1].reject(aborted());
    expect(note()).toHaveTextContent(
      `Stopped. ZIP 1 of ${view.count} is in your downloads. Resume to print the rest.`,
    );
    expect(primary()).toHaveTextContent("Resume from ZIP 2");
    expect(states().slice(0, 2)).toEqual(["✓ Downloaded", "Waiting"]);

    clickAndFlush(primary());
    expect(view.calls).toHaveLength(3);
    expect(view.calls[2].request.batch.index).toBe(1);
    expect(note()).toHaveTextContent("1 of");
    // ZIP 2 again, then every ZIP after it.
    for (let i = 2; i <= view.count; i++) await view.calls[i].resolve();
    expect(view.download).toHaveBeenCalledTimes(view.count);
    expect(view.download.mock.calls.at(-1)?.[1]).toMatch(
      new RegExp(` stems ${view.count} of ${view.count}\\.zip$`),
    );
  });

  it("says ZIPs 1–2 are in the downloads once two are", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    await view.calls[0].resolve();
    await view.calls[1].resolve();
    cancel();
    await view.calls[2].reject(aborted());
    expect(note()).toHaveTextContent(
      `Stopped. ZIPs 1–2 of ${view.count} are in your downloads.`,
    );
    expect(primary()).toHaveTextContent("Resume from ZIP 3");
  });

  it("says nothing and offers a fresh export when no ZIP had finished", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    cancel();
    await view.calls[0].reject(aborted());
    expect(note()).not.toHaveTextContent("Stopped");
    expect(primary()).toHaveAccessibleName("Export");
  });

  it("clears the resume point when the selection or the format changes", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    await view.calls[0].resolve();
    cancel();
    await view.calls[1].reject(aborted());
    expect(primary()).toHaveTextContent("Resume from ZIP 2");
    clickAndFlush(screen.getAllByRole("option")[0]);
    expect(primary()).toHaveAccessibleName("Export");
    expect(note()).not.toHaveTextContent("Stopped");
    expect(states().every((state) => state === "Waiting")).toBe(true);
  });
});

describe("ExportDialog: a ZIP that fails", () => {
  const decode = () => new OfflineRenderError("decode_failed", "bad asset");

  it("names the ZIP, what to do, and the ZIPs already downloaded", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    await view.calls[0].resolve();
    await view.calls[1].reject(decode());
    expect(alert()).toHaveTextContent(
      "ZIP 2 failed: a sound could not be loaded. Check your connection, then resume. ZIP 1 is already in your downloads.",
    );
    expect(alert().querySelector("b")).toHaveTextContent("ZIP 2 failed:");
    expect(states().slice(0, 3)).toEqual(["✓ Downloaded", "Failed", "Waiting"]);
    expect(note()).toBeEmptyDOMElement();
    expect(primary()).toHaveTextContent("Resume from ZIP 2");

    clickAndFlush(primary());
    expect(view.calls[2].request.batch.index).toBe(1);
    await view.calls[2].resolve();
    expect(view.download).toHaveBeenCalledTimes(2);
    expect(alert().textContent).toBe("");
  });

  it("ends with try again when nothing had finished", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    await view.calls[0].reject(decode());
    expect(alert()).toHaveTextContent(
      "ZIP 1 failed: a sound could not be loaded. Check your connection, then try again.",
    );
    expect(primary()).toHaveAccessibleName("Export");
  });

  it("keeps the one-file wording for a single ZIP", async () => {
    const view = renderDialog(createSliceFixtureProject());
    clickAndFlush(primary());
    await view.calls[0].reject(decode());
    expect(alert()).toHaveTextContent(
      "A sound in this project could not be loaded. Check your connection and try again.",
    );
    expect(alert().querySelector("b")).toBeNull();
  });
});

describe("zipFailure and stoppedNote", () => {
  it("uses the failure's own reason for any other code", () => {
    const failure = zipFailure({ zip: 3, done: 2, code: "internal", reason: "Oops." });
    expect(failure).toEqual({
      lead: "ZIP 3 failed:",
      text: "Oops. ZIPs 1–2 are already in your downloads.",
    });
  });

  it("pluralises what is in the downloads", () => {
    expect(stoppedNote(1, 3)).toMatch(/^Stopped\. ZIP 1 of 3 is in your downloads/);
    expect(stoppedNote(2, 3)).toMatch(/^Stopped\. ZIPs 1–2 of 3 are in your downloads/);
  });
});

describe("ExportDialog: the analytics of a batched export", () => {
  it("logs one trio across every ZIP, with the ZIP count", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    for (let k = 0; k < view.count; k++) await view.calls[k].resolve();
    expect(view.events()).toEqual(["export_started", "export_completed"]);
    expect(view.log).toHaveBeenCalledWith(
      "export_started",
      expect.objectContaining({ zip_count: view.count }),
    );
    expect(view.log).toHaveBeenCalledWith(
      "export_completed",
      expect.objectContaining({ zip_count: view.count }),
    );
  });

  it("logs one failure when Cancel lands between two ZIPs", async () => {
    const view = renderDialog();
    // Cancel from inside the first download: after ZIP 1 is handed over, before ZIP 2 starts.
    view.download.mockImplementation(() => cancel());
    clickAndFlush(primary());
    await view.calls[0].resolve();
    await settle();
    expect(view.calls).toHaveLength(1);
    expect(view.events()).toEqual(["export_started", "export_failed"]);
    expect(primary()).toHaveTextContent("Resume from ZIP 2");
    expect(note()).toHaveTextContent("Stopped. ZIP 1");
  });

  it("logs one failure when a ZIP fails", async () => {
    const view = renderDialog();
    clickAndFlush(primary());
    await view.calls[0].reject(new OfflineRenderError("decode_failed", "bad"));
    expect(view.events()).toEqual(["export_started", "export_failed"]);
  });
});
