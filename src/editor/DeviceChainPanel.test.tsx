import { cleanup, render, screen, within } from "@solidjs/testing-library";
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
  clickAndFlush(panel().getByRole("button", { name: "Add device" }));
  clickAndFlush(panel().getByRole("button", { name: label }));
}

describe("DeviceChainPanel", () => {
  it("shows an empty chain as an empty list, with a note", () => {
    const { panel, items } = renderPanel();
    expect(items()).toHaveLength(0);
    expect(panel().getByText("No devices on this track yet.")).toBeInTheDocument();
  });

  it("offers the six registered types, and appends each in order as one entry", () => {
    const { history, panel, items } = renderPanel();
    clickAndFlush(panel().getByRole("button", { name: "Add device" }));
    const offered = within(panel().getByRole("group", { name: "Device types" }))
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(offered).toEqual([
      "Filter",
      "Overdrive",
      "Saturator",
      "Compressor",
      "Delay",
      "Reverb",
    ]);
    clickAndFlush(panel().getByRole("button", { name: "Filter" }));
    // The offer closes once a type is chosen.
    expect(panel().queryByRole("group", { name: "Device types" })).toBeNull();

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
    expect(panel().getByRole("button", { name: "Add device" })).toBeEnabled();
    addFromPanel(panel, "Delay");
    expect(items()).toHaveLength(MAX_TRACK_INSERTS);
    expect(panel().getByRole("button", { name: "Add device" })).toBeDisabled();
    expect(panel().getByText(/holds up to 16 devices/)).toBeInTheDocument();
    for (const item of items()) {
      expect(within(item).getByRole("button", { name: /^Duplicate/ })).toBeDisabled();
    }
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
