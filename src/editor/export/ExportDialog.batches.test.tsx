import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../../domain/fixtures";
import { stubCanvasContext } from "../../testing/canvas";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import { type BatchCall, fakeStemsBatch } from "../../testing/stemsBatchFake";
import ExportDialog from "./ExportDialog";

/** A stems export that comes as several ZIPs, one after another (EXP-004). */

afterEach(cleanup);
stubCanvasContext();

function renderDialog(project: Project) {
  const fake = fakeStemsBatch(project.metadata.name);
  const download = vi.fn();
  render(() => (
    <ExportDialog
      project={() => project}
      exportStemsBatch={fake.exportStemsBatch}
      download={download}
      onClose={vi.fn()}
    />
  ));
  clickAndFlush(screen.getByRole("radio", { name: "Stems (ZIP)" }));
  return { ...fake, download };
}

const footer = () => document.querySelector(".export-footer") as HTMLElement;
const readout = (label: string) =>
  within(footer()).getByText(label, { selector: ".export-label" }).parentElement;
const cards = () =>
  [...document.querySelectorAll<HTMLElement>(".download")].map((card) => ({
    name: card.querySelector("b")?.textContent,
    state: card.querySelector(".download-state")?.textContent,
  }));
const progress = (call: BatchCall, fraction: number) =>
  fireAndFlush(() => call.request.onProgress?.(fraction));
const exportButton = () => screen.getByRole("button", { name: "Export" });

describe("ExportDialog: stems in several ZIPs", () => {
  const project = createReferenceProject();

  it("downloads each ZIP, in order, before it starts the next", async () => {
    const view = renderDialog(project);
    const count = cards().length;
    expect(count).toBeGreaterThan(2);
    clickAndFlush(exportButton());
    expect(view.calls).toHaveLength(1);
    expect(view.calls[0].request).toMatchObject({ count });
    expect(view.calls[0].request.batch.index).toBe(0);
    expect(view.calls[0].request.batch.hasMix).toBe(true);
    expect(view.download).not.toHaveBeenCalled();

    await view.calls[0].resolve();
    expect(view.download).toHaveBeenCalledTimes(1);
    expect(view.download.mock.calls[0][1]).toMatch(
      new RegExp(` stems 1 of ${count}\\.zip$`),
    );
    expect(view.calls).toHaveLength(2);
    expect(view.calls[1].request.batch.index).toBe(1);

    for (let k = 1; k < count; k++) await view.calls[k].resolve();
    expect(view.download.mock.calls.map((call) => call[1])).toEqual(
      Array.from({ length: count }, (_, k) =>
        expect.stringMatching(new RegExp(` stems ${k + 1} of ${count}\\.zip$`)),
      ),
    );
    // One date and one start across every ZIP.
    expect(new Set(view.calls.map((call) => call.request.startedAt)).size).toBe(1);
    expect(new Set(view.calls.map((call) => String(call.request.date))).size).toBe(1);
    expect(cards().every((card) => card.state === "✓ Downloaded")).toBe(true);
  });

  it("walks the cards Waiting, Printing, Downloaded and reads the ZIP in the footer", async () => {
    const view = renderDialog(project);
    const count = cards().length;
    clickAndFlush(exportButton());
    progress(view.calls[0], 0.5);
    expect(cards()[0].state).toBe("Printing 50%");
    expect(cards()[1].state).toBe("Waiting");
    expect(readout("Printing")?.textContent).toMatch(
      new RegExp(`^PrintingZIP 1 of ${count} · bar \\d+ of \\d+$`),
    );
    const bar = within(footer()).getByRole("progressbar", { name: "Export progress" });
    expect(Number(bar.getAttribute("value"))).toBeCloseTo(0.5 / count);

    await view.calls[0].resolve();
    progress(view.calls[1], 0.25);
    expect(cards()[0].state).toBe("✓ Downloaded");
    expect(cards()[1].state).toBe("Printing 25%");
    expect(readout("Printing")?.textContent).toMatch(new RegExp(`ZIP 2 of ${count}`));
    expect(Number(bar.getAttribute("value"))).toBeCloseTo(1.25 / count);
    expect(document.getElementById("export-note")).toHaveTextContent(
      `1 of ${count} in your downloads.`,
    );
  });

  it("scrolls the list to each ZIP's first stem as it starts", async () => {
    const view = renderDialog(project);
    const scroller = document.querySelector(".track-lanes-scroll") as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as never;
    clickAndFlush(exportButton());
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    await view.calls[0].resolve();
    const first = view.calls[1].request.batch.rowIds[0];
    const index = [...document.querySelectorAll('[role="option"]')].findIndex((option) =>
      option.id.endsWith(first),
    );
    expect(index).toBeGreaterThan(0);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: index * 24 }),
    );
  });
});

describe("ExportDialog: the note about the split", () => {
  const note = () => document.getElementById("export-note");

  it("says how an over-budget selection splits, in one line of the message slot", () => {
    renderDialog(createReferenceProject());
    const count = cards().length;
    expect(note()?.textContent).toMatch(
      new RegExp(
        `^\\d\\.\\d\\d GiB is over the 2 GiB browser limit, so stems come as ${count} ZIPs in track order, each downloaded when ready\\.$`,
      ),
    );
  });

  it("says stems that fit come as one, and says nothing for the stereo mix", () => {
    renderDialog(createSliceFixtureProject());
    expect(note()).toHaveTextContent(
      "Stems over 2 GiB come as several ZIPs in track order. These fit in one.",
    );
    clickAndFlush(screen.getByRole("radio", { name: "Stereo WAV" }));
    expect(note()).toBeEmptyDOMElement();
  });
});

describe("ExportDialog: stems that fit one ZIP", () => {
  it("makes exactly one ZIP, named as it always was, with no ZIP prefix in the readout", async () => {
    const project = createSliceFixtureProject();
    const view = renderDialog(project);
    expect(cards()).toHaveLength(1);
    clickAndFlush(exportButton());
    expect(view.calls[0].request.count).toBe(1);
    progress(view.calls[0], 0.5);
    expect(readout("Printing")?.textContent).toMatch(/^Printingbar \d+ of \d+$/);
    await view.calls[0].resolve();
    expect(view.download).toHaveBeenCalledTimes(1);
    expect(view.download.mock.calls[0][1]).toMatch(/ \d{4}-\d{2}-\d{2} stems\.zip$/);
    expect(view.calls).toHaveLength(1);
  });
});
