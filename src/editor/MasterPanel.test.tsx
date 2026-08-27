import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { CommandHistory, masterChain, removeDevice } from "../commands";
import { deviceTypes } from "../domain/devices";
import { createSliceFixtureProject } from "../domain/fixtures";
import type { DeviceId } from "../domain/ids";
import { testAnalytics } from "../instrument/panelTesting";
import { fireAndFlush } from "../testing/events";
import MasterPanel from "./MasterPanel";

afterEach(() => cleanup());

/** Over a real `CommandHistory`, so "one revision, one entry, undoable" is
 * proven against the command layer rather than a spy that agrees with itself. */
function renderPanel(options: { optedOut?: boolean; refuseEdits?: boolean } = {}) {
  const history = new CommandHistory(createSliceFixtureProject());
  const [project, setProject] = createSignal(history.project);
  const { analytics, transport } = testAnalytics(options);

  render(() => (
    <MasterPanel
      project={project()}
      dispatch={(commands) => {
        const result = history.execute(
          options.refuseEdits
            ? removeDevice(masterChain, "dev_absent00000000000" as DeviceId)
            : commands,
        );
        setProject(history.project);
        return result;
      }}
      beginGesture={(gestureOptions) => history.beginGesture(gestureOptions)}
      analytics={analytics}
    />
  ));

  function replay(step: "undo" | "redo"): void {
    fireAndFlush(() => {
      history[step]();
      setProject(history.project);
    });
  }
  return {
    history,
    transport,
    chain: () => history.project.song.master.devices,
    undo: () => replay("undo"),
    redo: () => replay("redo"),
  };
}

/** The chain's own list — the ordered thing the flow counts devices in. */
const chainList = () => screen.getByRole("list", { name: "Master chain" });
const chainItems = () => within(chainList()).queryAllByRole("listitem");

const click = (element: HTMLElement) => fireAndFlush(() => fireEvent.click(element));
const openAddMenu = () => click(screen.getByRole("button", { name: /^Add device/i }));

function addDeviceNamed(label: string): void {
  openAddMenu();
  click(screen.getByRole("menuitem", { name: label }));
}

describe("MasterPanel", () => {
  it("starts with an empty, still-present chain and says so", () => {
    renderPanel();
    expect(chainItems()).toHaveLength(0);
    expect(screen.getByText(/Nothing on the master yet/)).toBeInTheDocument();
  });

  it("offers every registered device type, by its registry definition", () => {
    renderPanel();
    openAddMenu();
    const offered = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    // The registry's own labels in its own order, not a list copied into the
    // component: a seventh type is offered here with no edit to the panel.
    expect(offered).toEqual(deviceTypes().map((definition) => definition.label));
    expect(offered).toHaveLength(6);
  });

  it("adds a device as one revision and one undoable history entry", () => {
    const { history, chain, undo, redo } = renderPanel();
    const revisionBefore = history.project.metadata.revision;

    addDeviceNamed("Overdrive");
    expect(chainItems()).toHaveLength(1);
    expect(chainList()).toHaveTextContent("Overdrive");
    expect(chain()).toHaveLength(1);
    expect(chain()[0].type).toBe("overdrive");
    expect(history.project.metadata.revision).toBe(revisionBefore + 1);
    expect(history.entries).toHaveLength(1);

    // CF-007 steps 5-6: nothing edited since the add, so one undo removes it.
    undo();
    expect(chainItems()).toHaveLength(0);
    redo();
    expect(chainItems()).toHaveLength(1);
    expect(chainList()).toHaveTextContent("Overdrive");
  });

  it("keeps the chain in order as devices are added", () => {
    const { chain } = renderPanel();
    addDeviceNamed("Overdrive");
    addDeviceNamed("Reverb");
    expect(chain().map((device) => device.type)).toEqual(["overdrive", "reverb"]);
    expect(chainItems()[0]).toHaveTextContent("Overdrive");
    expect(chainItems()[1]).toHaveTextContent("Reverb");
  });

  it("logs the added device's type once, and its chain, with no names", () => {
    const { transport } = renderPanel();
    addDeviceNamed("Overdrive");

    const added = transport.events.filter((event) => event.name === "device_added");
    expect(added).toHaveLength(1);
    expect(added[0].params).toMatchObject({ device_type: "overdrive", chain: "master" });
    expect(transport.events.filter((e) => e.name === "feature_first_use")).toHaveLength(
      1,
    );
  });

  it("still adds the device when analytics is switched off, and reports nothing", () => {
    // Telemetry off changes what is reported and nothing else.
    const { chain, transport } = renderPanel({ optedOut: true });
    addDeviceNamed("Overdrive");
    expect(chain()).toHaveLength(1);
    expect(chainItems()).toHaveLength(1);
    expect(transport.events).toHaveLength(0);
  });

  it("reports a refused edit rather than swallowing it", () => {
    // A real refusal from the command layer (an absent device id), so the code
    // the panel classifies is one the kernel actually produces.
    const { transport, chain } = renderPanel({ refuseEdits: true });
    addDeviceNamed("Overdrive");
    expect(chain()).toHaveLength(0);
    const failures = transport.events.filter((e) => e.name === "device_edit_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].params).toMatchObject({
      operation: "add",
      error_code: "internal",
    });
    // No identity of the device, chain, track or project it failed on, and a
    // refused add is not reported as an add.
    expect(JSON.stringify(failures[0].params)).not.toContain("dev_");
    expect(
      transport.events.filter((event) => event.name === "device_added"),
    ).toHaveLength(0);
  });
});
