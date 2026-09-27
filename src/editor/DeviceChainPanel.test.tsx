import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { addDevice, CommandHistory, insertChain } from "../commands";
import { createDevice } from "../domain/devices";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { MAX_TRACK_INSERTS } from "../domain/parse";
import { moveTo } from "../instrument/panelTesting";
import { clickAndFlush, fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import DeviceChainPanel from "./DeviceChainPanel";

afterEach(() => cleanup());

function recordingAnalytics(options = { allowed: true }) {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  if (!options.allowed) consent.optOut();
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
  analytics.setAccountType("anonymous");
  return { transport, analytics };
}

/** The panel over a real history, showing the fixture's first track. */
function renderPanel(options: { preload?: number; allowed?: boolean } = {}) {
  const history = new CommandHistory(createPianoRollFixtureProject());
  const trackId = history.project.song.tracks[0].id;
  const ids = createSeededIdFactory("device-chain-panel");
  for (let order = 0; order < (options.preload ?? 0); order += 1) {
    history.execute(
      addDevice(insertChain(trackId), createDevice(ids("device"), "filter", order)),
    );
  }
  const [project, setProject] = createSignal(history.project);
  history.subscribe(() => setProject(history.project));
  const { transport, analytics } = recordingAnalytics({
    allowed: options.allowed ?? true,
  });
  render(() => (
    <DeviceChainPanel
      track={project().song.tracks[0]}
      dispatch={(commands) => history.execute(commands)}
      beginGesture={(gesture) => history.beginGesture(gesture)}
      analytics={analytics}
      ids={ids}
    />
  ));
  const panel = () => within(screen.getByRole("region", { name: "Device chain" }));
  const items = () =>
    within(panel().getByRole("list", { name: "Device chain" })).queryAllByRole(
      "listitem",
    );
  return { history, project, transport, panel, items };
}

function addFromPanel(panel: ReturnType<typeof renderPanel>["panel"], label: string) {
  clickAndFlush(
    panel().getByRole("button", { name: `Add ${label.toLowerCase()} device` }),
  );
}

/** A drag of `from`'s card, pressed on `handle`, dropped on `to`'s card. */
function dragCard(from: HTMLElement, handle: Element, to: HTMLElement) {
  const dataTransfer = {
    setData() {},
    getData: () => "",
    effectAllowed: "",
    dropEffect: "",
  };
  fireAndFlush(() => {
    fireEvent.pointerDown(handle);
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });
    fireEvent.dragEnd(from, { dataTransfer });
  });
}

describe("DeviceChainPanel", () => {
  it("shows an empty chain as an empty list, with a note", () => {
    const { panel, items } = renderPanel();
    expect(items()).toHaveLength(0);
    expect(panel().getByText("No devices on this track yet.")).toBeInTheDocument();
  });

  it("offers one add button per registered type, and appends each in order as one entry", () => {
    const { history, panel, items } = renderPanel();
    const addButtons = () =>
      within(panel().getByRole("group", { name: "Add device" })).getAllByRole("button");
    // At the end of the chain, where the next device goes — as the add-track
    // buttons sit below the last track.
    expect(
      panel()
        .getByRole("list", { name: "Device chain" })
        .compareDocumentPosition(panel().getByRole("group", { name: "Add device" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const offered = addButtons().map((button) => button.textContent);
    expect(offered).toEqual([
      "Filter",
      "Overdrive",
      "Saturator",
      "Compressor",
      "Delay",
      "Reverb",
    ]);
    addFromPanel(panel, "Filter");
    // The buttons stay where they are, after the chain, ready for the next one.
    expect(addButtons()).toHaveLength(6);

    const entries = history.entries.length;
    addFromPanel(panel, "Delay");
    expect(items().map((item) => within(item).getByRole("heading").textContent)).toEqual([
      "Filter",
      "Delay",
    ]);
    expect(history.entries.length).toBe(entries + 1);
    fireAndFlush(() => history.undo());
    expect(items()).toHaveLength(1);
  });

  it("logs device_added once per add, and device_chain's first use once", () => {
    const { transport, panel } = renderPanel();
    addFromPanel(panel, "Filter");
    addFromPanel(panel, "Reverb");
    expect(transport.named("device_added").map((event) => event.params)).toEqual([
      expect.objectContaining({ device_type: "filter", chain: "insert" }),
      expect.objectContaining({ device_type: "reverb", chain: "insert" }),
    ]);
    expect(
      transport
        .named("feature_first_use")
        .filter((event) => event.params.feature === "device_chain"),
    ).toHaveLength(1);
  });

  it("changes nothing but the telemetry when analytics is off", () => {
    const { transport, panel, items } = renderPanel({ allowed: false });
    addFromPanel(panel, "Compressor");
    expect(items()).toHaveLength(1);
    expect(transport.events).toEqual([]);
  });

  it(`stops adding and duplicating at ${MAX_TRACK_INSERTS} inserts`, () => {
    const { panel, items } = renderPanel({ preload: MAX_TRACK_INSERTS - 1 });
    const addButtons = () =>
      within(panel().getByRole("group", { name: "Add device" })).getAllByRole("button");
    for (const button of addButtons()) expect(button).toBeEnabled();
    addFromPanel(panel, "Delay");
    expect(items()).toHaveLength(MAX_TRACK_INSERTS);
    for (const button of addButtons()) expect(button).toBeDisabled();
    expect(panel().getByText(/holds up to 16 devices/)).toBeInTheDocument();
    for (const item of items()) {
      expect(within(item).getByRole("button", { name: /^Duplicate/ })).toBeDisabled();
    }
  });

  it("moves a device by dragging its header onto another, as one entry", () => {
    const { history, panel, items } = renderPanel();
    addFromPanel(panel, "Overdrive");
    addFromPanel(panel, "Reverb");
    const names = () =>
      items().map((item) => within(item).getByRole("heading").textContent);
    const entries = history.entries.length;
    const [overdrive, reverb] = items();
    dragCard(reverb, reverb.querySelector("header") as Element, overdrive);
    expect(names()).toEqual(["Reverb", "Overdrive"]);
    expect(history.entries.length).toBe(entries + 1);
    fireAndFlush(() => history.undo());
    expect(names()).toEqual(["Overdrive", "Reverb"]);
  });

  it("previews the new order while a card is held, and restores it on a cancelled drag", () => {
    const { history, panel, items } = renderPanel();
    addFromPanel(panel, "Overdrive");
    addFromPanel(panel, "Reverb");
    const [overdrive, reverb] = items();
    const shown = () => [overdrive.style.order, reverb.style.order];
    const entries = history.entries.length;
    const dataTransfer = {
      setData() {},
      getData: () => "",
      effectAllowed: "",
      dropEffect: "",
    };

    fireAndFlush(() => {
      fireEvent.pointerDown(reverb.querySelector("header") as Element);
      fireEvent.dragStart(reverb, { dataTransfer });
      fireEvent.dragOver(overdrive, { dataTransfer });
    });
    // Reverb shows first, the chain it would become; nothing is committed yet.
    expect(shown()).toEqual(["1", "0"]);
    expect(reverb).toHaveClass("dragging");
    expect(history.entries.length).toBe(entries);

    // Let go outside the chain: dragend alone, no drop.
    fireAndFlush(() => fireEvent.dragEnd(reverb, { dataTransfer }));
    expect(shown()).toEqual(["0", "1"]);
    expect(history.entries.length).toBe(entries);
  });

  it("does not start a drag from one of the card's controls", () => {
    const { panel, items } = renderPanel();
    addFromPanel(panel, "Filter");
    addFromPanel(panel, "Delay");
    const [filter, delay] = items();
    dragCard(delay, within(delay).getAllByRole("slider")[0], filter);
    expect(items().map((item) => within(item).getByRole("heading").textContent)).toEqual([
      "Filter",
      "Delay",
    ]);
  });

  it("moves the device whose name has focus with Alt+Up and Alt+Down", () => {
    const { history, panel, items } = renderPanel();
    addFromPanel(panel, "Overdrive");
    addFromPanel(panel, "Reverb");
    const names = () =>
      items().map((item) => within(item).getByRole("heading").textContent);
    const grip = (name: string) => panel().getByRole("button", { name });
    const press = (key: string) =>
      fireAndFlush(() =>
        fireEvent.keyDown(document.activeElement ?? document.body, { key, altKey: true }),
      );

    fireAndFlush(() => grip("Reverb").focus());
    const entries = history.entries.length;
    press("ArrowUp");
    expect(names()).toEqual(["Reverb", "Overdrive"]);
    expect(history.entries.length).toBe(entries + 1);
    // Already first: nothing to do, and no entry.
    press("ArrowUp");
    expect(history.entries.length).toBe(entries + 1);
    press("ArrowDown");
    expect(names()).toEqual(["Overdrive", "Reverb"]);
  });

  it("keeps a slider in place through a drag, committing it as one entry", () => {
    const { history, panel, items, project } = renderPanel();
    addFromPanel(panel, "Filter");
    const entries = history.entries.length;
    const cutoff = within(items()[0]).getByRole("slider", {
      name: "Cutoff",
    }) as HTMLInputElement;
    moveTo(cutoff, "4000");
    moveTo(cutoff, "800");
    // The same element the pointer started on: the card was not rebuilt.
    expect(within(items()[0]).getByRole("slider", { name: "Cutoff" })).toBe(cutoff);
    fireAndFlush(() => cutoff.dispatchEvent(new Event("change", { bubbles: true })));
    expect(project().song.tracks[0].devices[0].parameters.cutoff).toBe(800);
    expect(history.entries.length).toBe(entries + 1);
  });
});
