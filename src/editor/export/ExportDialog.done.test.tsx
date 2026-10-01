import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../../domain/fixtures";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush } from "../../testing/events";
import { fakeStemsBatch, settle } from "../../testing/stemsBatchFake";
import ExportDialog from "./ExportDialog";

/** The finished screen in place of the dialog's contents, once an export completes (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

function renderDialog(project: Project) {
  const fake = fakeStemsBatch(project.metadata.name);
  const exportWav = vi.fn(async () => ({
    blob: new Blob([new Uint8Array([1])]),
    fileName: "Song.wav",
  }));
  const onClose = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      exportWav={exportWav as never}
      exportStemsBatch={fake.exportStemsBatch}
      download={vi.fn()}
      onClose={onClose}
    />
  ));
  return { ...fake, onClose };
}

const primary = () => document.querySelector(".export-primary") as HTMLElement;
const dialog = () => screen.getByRole("dialog", { name: "Export" });

async function exportStereo(project = createSliceFixtureProject()) {
  const view = renderDialog(project);
  clickAndFlush(primary());
  await settle();
  return { ...view, project };
}

describe("ExportDialog: the finished screen", () => {
  it("gives the contents way to it, announcing completion in exactly one place", async () => {
    const { project, onClose } = await exportStereo();
    expect(screen.getByRole("status")).toHaveTextContent("Export complete");
    expect(
      screen.getByRole("heading", { name: `${project.metadata.name} is out.` }),
    ).toBeVisible();
    expect(within(dialog()).getAllByText(/\b(done|complete|finished)\b/i)).toHaveLength(
      1,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("region", { name: "Downloads" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Close\b/ })).toBeVisible();
    const back = screen.getByRole("button", { name: "Back to the song" });
    expect(back).toHaveFocus();
    clickAndFlush(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lists every ZIP of a batched export, with the Stems readout", async () => {
    const view = renderDialog(createReferenceProject());
    clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
    const count = document.querySelectorAll(".download").length;
    clickAndFlush(primary());
    for (let k = 0; k < count; k++) await view.calls[k].resolve();
    expect(screen.getByRole("status")).toHaveTextContent("Export complete");
    expect(
      screen.getByText(`${count} ZIPs are in your downloads.`, { exact: false }),
    ).toBeVisible();
    const items = within(screen.getByRole("list", { name: "ZIPs" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(count);
    expect(items[0]).toHaveTextContent(
      new RegExp(` stems 1 of ${count}\\.zip\\d\\.\\d\\d GiB$`),
    );
  });

  it("offers the other format, back at the choice with it picked", async () => {
    await exportStereo();
    clickAndFlush(screen.getByRole("button", { name: "Export stems too" }));
    expect(screen.queryByRole("heading", { name: /is out\./ })).toBeNull();
    expect(screen.getByRole("radio", { name: "Stems (ZIP)" })).toBeChecked();
    expect(primary()).toHaveAccessibleName("Export");
    expect(screen.getAllByRole("option")[0]).toHaveAccessibleName(/included$/);
  });
});
