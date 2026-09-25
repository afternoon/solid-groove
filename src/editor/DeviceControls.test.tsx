import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { addDevice, CommandHistory, insertChain } from "../commands";
import { createDevice, type DeviceTypeId, deviceParameters } from "../domain/devices";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { defineParameter } from "../domain/parameters";
import { moveTo } from "../instrument/panelTesting";
import { clickAndFlush, fireAndFlush } from "../testing/events";
import DeviceControls from "./DeviceControls";
import { deviceChoices } from "./deviceControlModel";

afterEach(() => cleanup());

/**
 * One track carrying the given devices, over a real command history, so every
 * control's value comes back out of the project it edits.
 */
function renderDevices(types: readonly DeviceTypeId[]) {
  const history = new CommandHistory(createPianoRollFixtureProject());
  const trackId = history.project.song.tracks[0].id;
  const ids = createSeededIdFactory("device-controls");
  types.forEach((type, order) => {
    history.execute(
      addDevice(insertChain(trackId), createDevice(ids("device"), type, order)),
    );
  });
  const [project, setProject] = createSignal(history.project);
  history.subscribe(() => setProject(history.project));
  const devices = () => project().song.tracks[0].devices;
  render(() => (
    <ul>
      {types.map((_, index) => (
        <li data-testid={`device-${index}`}>
          <DeviceControls
            trackId={trackId}
            device={devices()[index]}
            dispatch={(commands) => history.execute(commands)}
            beginGesture={(options) => history.beginGesture(options)}
          />
        </li>
      ))}
    </ul>
  ));
  return {
    history,
    devices,
    device: (index: number) => screen.getByTestId(`device-${index}`),
  };
}

describe("DeviceControls", () => {
  it("shows a filter's own controls, from its definitions, not a preset list", () => {
    const { device } = renderDevices(["filter"]);
    const filter = within(device(0));
    expect(filter.getByRole("slider", { name: "Cutoff" })).toHaveValue("1000");
    expect(filter.getByRole("slider", { name: "Resonance" })).toBeInTheDocument();
    expect(filter.getByRole("slider", { name: "Dry/Wet" })).toBeInTheDocument();
    const mode = filter.getByRole("group", { name: "Mode" });
    expect(
      within(mode)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["Low pass", "High pass", "Band pass"]);
    expect(filter.queryByRole("combobox")).toBeNull();
  });

  it("gives every device type a control per parameter", () => {
    const types: DeviceTypeId[] = [
      "overdrive",
      "saturator",
      "compressor",
      "delay",
      "reverb",
    ];
    const { device } = renderDevices(types);
    types.forEach((type, index) => {
      const labels = deviceParameters(type).map((definition) => definition.label);
      for (const label of labels) {
        const scope = within(device(index));
        expect(
          scope.queryByRole("slider", { name: label }) ??
            scope.queryByRole("group", { name: label }),
        ).not.toBeNull();
      }
    });
  });

  it("commits a whole slider drag as one history entry and one revision", () => {
    const { history, devices, device } = renderDevices(["filter"]);
    const entries = history.entries.length;
    const revision = history.project.metadata.revision;
    const cutoff = within(device(0)).getByRole("slider", {
      name: "Cutoff",
    }) as HTMLInputElement;

    moveTo(cutoff, "3000");
    moveTo(cutoff, "2000");
    moveTo(cutoff, "800");
    // The control follows the pointer before release.
    expect(cutoff).toHaveValue("800");
    fireAndFlush(() => fireEvent.change(cutoff, { target: { value: "800" } }));

    expect(devices()[0].parameters.cutoff).toBe(800);
    expect(history.entries.length).toBe(entries + 1);
    expect(history.project.metadata.revision).toBe(revision + 1);

    fireAndFlush(() => history.undo());
    expect(devices()[0].parameters.cutoff).toBe(1000);
    expect(cutoff).toHaveValue("1000");
  });

  it("sets a mode by its name, as one command storing the choice's index", () => {
    const { history, devices, device } = renderDevices(["delay"]);
    const entries = history.entries.length;
    const division = within(device(0)).getByRole("group", { name: "Division" });
    clickAndFlush(within(division).getByRole("radio", { name: "1/8 dotted" }));
    expect(devices()[0].parameters.division).toBe(4);
    expect(history.entries.length).toBe(entries + 1);
    clickAndFlush(within(device(0)).getByRole("radio", { name: "Free" }));
    expect(devices()[0].parameters.sync).toBe(0);
  });

  it("keeps two devices of one type independent", () => {
    const { devices, device } = renderDevices(["delay", "delay"]);
    clickAndFlush(within(device(1)).getByRole("radio", { name: "Free" }));
    expect(devices()[0].parameters.sync).toBe(1);
    expect(devices()[1].parameters.sync).toBe(0);
    // Separate radio groups: the first delay still shows "Synced" checked.
    expect(within(device(0)).getByRole("radio", { name: "Synced" })).toBeChecked();
    expect(within(device(1)).getByRole("radio", { name: "Free" })).toBeChecked();

    const first = within(device(0)).getByRole("slider", { name: "Feedback" });
    const second = within(device(1)).getByRole("slider", { name: "Feedback" });
    expect(first.id).not.toBe(second.id);
  });
});

describe("deviceChoices", () => {
  it("is null for a continuous parameter", () => {
    const [cutoff] = deviceParameters("filter");
    expect(deviceChoices(cutoff)).toBeNull();
  });

  it("falls back to numbers for a stepped mode nobody has named", () => {
    const unnamed = defineParameter({
      id: "test.unnamedMode",
      label: "Mode",
      unit: "normalized",
      min: 0,
      max: 2,
      defaultValue: 0,
      step: 1,
      clampPolicy: "reject",
      automatable: false,
    });
    expect(deviceChoices(unnamed)?.map((choice) => choice.label)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });
});
