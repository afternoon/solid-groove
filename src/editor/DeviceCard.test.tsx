import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { createSignal, For, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { addDevice, CommandHistory, insertChain, setParameter } from "../commands";
import { createDevice, type DeviceTypeId } from "../domain/devices";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { clickAndFlush, fireAndFlush } from "../testing/events";
import DeviceCard from "./DeviceCard";

afterEach(() => cleanup());

/** A track carrying `types`, each rendered as a card over a real history. */
function renderChain(types: readonly DeviceTypeId[], options = { canDuplicate: true }) {
  const history = new CommandHistory(createPianoRollFixtureProject());
  const trackId = history.project.song.tracks[0].id;
  const ids = createSeededIdFactory("device-card");
  types.forEach((type, order) => {
    history.execute(
      addDevice(insertChain(trackId), createDevice(ids("device"), type, order)),
    );
  });
  const [project, setProject] = createSignal(history.project);
  history.subscribe(() => setProject(history.project));
  const devices = () => project().song.tracks[0].devices;
  const copyIds = createSeededIdFactory("device-card-copies");
  const copyId = copyIds("device");
  render(() => (
    <ul aria-label="Chain">
      {/* Keyed on the id, as the panel is: keyed on the object, an edit would
          remount the card under the pointer. */}
      <For each={devices()} keyed={(device) => device.id}>
        {(device) => (
          <li>
            <DeviceCard
              trackId={trackId}
              device={device()}
              canDuplicate={options.canDuplicate}
              newDeviceId={() => copyId}
              dispatch={(commands) => history.execute(commands)}
              beginGesture={(gesture) => history.beginGesture(gesture)}
            />
          </li>
        )}
      </For>
    </ul>
  ));
  const card = (index: number) => within(screen.getAllByRole("listitem")[index]);
  const types_ = () => devices().map((device) => device.type);
  return { history, devices, card, types: types_, trackId, copyId };
}

describe("DeviceCard", () => {
  it("names the device and gives it its own controls", () => {
    const { card } = renderChain(["reverb"]);
    expect(card(0).getByRole("heading", { name: "Reverb" })).toBeInTheDocument();
    expect(card(0).getByRole("slider", { name: "Size" })).toBeInTheDocument();
  });

  it("bypasses in place, keeping its settings, as one undoable entry", () => {
    const { history, devices, card } = renderChain(["overdrive", "reverb"]);
    const entries = history.entries.length;
    const before = devices()[0].parameters;
    const bypass = card(0).getByRole("button", { name: "Bypass Overdrive" });
    expect(bypass).toHaveAttribute("aria-pressed", "false");

    clickAndFlush(bypass);
    expect(bypass).toHaveAttribute("aria-pressed", "true");
    expect(devices()[0]).toMatchObject({
      type: "overdrive",
      bypassed: true,
      parameters: before,
    });
    expect(history.entries.length).toBe(entries + 1);

    clickAndFlush(bypass);
    expect(devices()[0].bypassed).toBe(false);
    fireAndFlush(() => history.undo());
    expect(devices()[0].bypassed).toBe(true);
  });

  it("offers its actions as named icon buttons, with no reorder arrows", () => {
    const { card } = renderChain(["overdrive", "reverb"]);
    const actions = card(0).getAllByRole("button");
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Bypass Overdrive",
      "Duplicate Overdrive",
      "Reset Overdrive",
      "Remove Overdrive",
    ]);
    for (const button of actions) {
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("duplicates directly after itself with the same settings and the given id", () => {
    const { history, devices, card, types, trackId, copyId } = renderChain([
      "reverb",
      "overdrive",
    ]);
    history.execute(
      setParameter(
        { scope: "trackDevice", trackId, deviceId: devices()[0].id, parameterId: "size" },
        0.8,
      ),
    );
    const entries = history.entries.length;
    clickAndFlush(card(0).getByRole("button", { name: "Duplicate Reverb" }));
    expect(types()).toEqual(["reverb", "reverb", "overdrive"]);
    expect(devices()[1]).toMatchObject({ id: copyId, parameters: { size: 0.8 } });
    expect(history.entries.length).toBe(entries + 1);
  });

  it("offers no duplicate once the chain is full", () => {
    const { card } = renderChain(["reverb"], { canDuplicate: false });
    expect(card(0).getByRole("button", { name: "Duplicate Reverb" })).toBeDisabled();
  });

  it("resets to the definition's defaults, and undo brings the settings back", () => {
    const { history, devices, card, trackId } = renderChain(["reverb"]);
    history.execute(
      setParameter(
        { scope: "trackDevice", trackId, deviceId: devices()[0].id, parameterId: "size" },
        0.9,
      ),
    );
    const size = card(0).getByRole("slider", { name: "Size" });
    flush();
    expect(size).toHaveValue("0.9");

    clickAndFlush(card(0).getByRole("button", { name: "Reset Reverb" }));
    expect(size).toHaveValue("0.5");
    fireAndFlush(() => history.undo());
    expect(size).toHaveValue("0.9");
  });

  it("removes, and undo puts it back in the same place", () => {
    const { history, card, types } = renderChain(["reverb", "delay", "overdrive"]);
    const entries = history.entries.length;
    clickAndFlush(card(1).getByRole("button", { name: "Remove Delay" }));
    expect(types()).toEqual(["reverb", "overdrive"]);
    expect(history.entries.length).toBe(entries + 1);
    fireAndFlush(() => history.undo());
    expect(types()).toEqual(["reverb", "delay", "overdrive"]);
  });
});
