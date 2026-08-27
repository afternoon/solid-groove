import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { Show } from "@solidjs/web";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { addDevice, CommandHistory, masterChain } from "../commands";
import { createDevice, type DeviceTypeId } from "../domain/devices";
import { createFactoryContext } from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
import { moveTo } from "../instrument/panelTesting";
import { fireAndFlush } from "../testing/events";
import MasterDevice from "./MasterDevice";

afterEach(() => cleanup());

/** The same ID factory production uses; nothing here asserts on a suffix. */
const { ids } = createFactoryContext();

/**
 * One card over a real `CommandHistory` seeded with a chain, so "one revision
 * and one history entry apiece, undoable" is proven against the command layer.
 */
function renderCard(types: DeviceTypeId[] = ["overdrive"], index = 0) {
  let history = new CommandHistory(createSliceFixtureProject());
  for (const [order, type] of types.entries()) {
    const result = history.execute(
      addDevice(masterChain, createDevice(ids("device"), type, order)),
    );
    if (!result.ok) throw new Error(result.issues[0].message);
  }
  history = new CommandHistory(history.project);
  const [project, setProject] = createSignal(history.project);
  const device = () => project().song.master.devices[index];

  // A `Show`, because the real parent is a `<For>` over the chain: removing
  // the device unmounts its card rather than handing this one `undefined`.
  render(() => (
    <Show when={device()}>
      {(current) => (
        <MasterDevice
          device={current()}
          index={index}
          count={types.length}
          edit={(_operation, command) => {
            const result = history.execute(command);
            setProject(history.project);
            return result.ok;
          }}
          dispatch={(commands) => {
            const result = history.execute(commands);
            setProject(history.project);
            return result;
          }}
          beginGesture={(options) => history.beginGesture(options)}
        />
      )}
    </Show>
  ));

  return { history, chain: () => history.project.song.master.devices };
}

const click = (name: RegExp | string) =>
  fireAndFlush(() => fireEvent.click(screen.getByRole("button", { name })));

describe("MasterDevice", () => {
  it("names the device and its position, and carries its own controls", () => {
    renderCard();
    const card = within(screen.getByRole("group", { name: "Overdrive, position 1" }));
    // Generated from `deviceParameters("overdrive")`, not from this card.
    expect(card.getByRole("slider", { name: "Drive" })).toBeInTheDocument();
    expect(card.getByRole("slider", { name: "Tone" })).toBeInTheDocument();
  });

  it("writes a control onto this device's own chain, as one gesture", () => {
    const { history, chain } = renderCard();
    const entriesBefore = history.entries.length;
    const drive = screen.getByRole("slider", { name: "Drive" }) as HTMLInputElement;

    moveTo(drive, "0.5");
    moveTo(drive, "0.8");
    fireAndFlush(() => fireEvent.change(drive, { target: { value: "0.8" } }));

    // CF-007 step 7: the drive lands on the master's device, and the whole
    // drag is one entry however many moves it took.
    expect(chain()[0].parameters.drive).toBe(0.8);
    expect(history.entries.length).toBe(entriesBefore + 1);
  });

  it("removes, bypasses and resets, one revision and one entry each", () => {
    const { history, chain } = renderCard();
    const revisionBefore = history.project.metadata.revision;

    click(/^Bypass Overdrive/);
    expect(chain()[0].bypassed).toBe(true);
    expect(screen.getByRole("button", { name: /^Bypass Overdrive/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Reset restores the factory values without moving or un-bypassing it.
    const drive = screen.getByRole("slider", { name: "Drive" }) as HTMLInputElement;
    moveTo(drive, "0.9");
    fireAndFlush(() => fireEvent.change(drive, { target: { value: "0.9" } }));
    click(/^Reset Overdrive/);
    expect(chain()[0].parameters.drive).toBe(0.3);
    expect(chain()[0].bypassed).toBe(true);

    click(/^Remove Overdrive/);
    expect(chain()).toHaveLength(0);
    // Bypass, the drag, reset and remove: four revisions, four entries.
    expect(history.project.metadata.revision).toBe(revisionBefore + 4);
    expect(history.entries).toHaveLength(4);
  });

  it("duplicates into an independent device rather than a second reference", () => {
    const { chain } = renderCard();
    click(/^Duplicate Overdrive/);
    expect(chain()).toHaveLength(2);
    expect(chain()[1].id).not.toBe(chain()[0].id);
    expect(chain()[1].type).toBe("overdrive");
  });

  it("undoes any chain edit as a single step", () => {
    const { history, chain } = renderCard();
    click(/^Duplicate Overdrive/);
    expect(chain()).toHaveLength(2);
    history.undo();
    expect(history.project.song.master.devices).toHaveLength(1);
  });

  it("disables the move that would take the device off the end of the chain", () => {
    renderCard(["overdrive", "reverb"], 0);
    expect(screen.getByRole("button", { name: /earlier/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /later/ })).toBeEnabled();
  });

  it("reorders through the chain command", () => {
    const { chain } = renderCard(["overdrive", "reverb"], 0);
    click(/^Move Overdrive, position 1 later/);
    expect(chain().map((device) => device.type)).toEqual(["reverb", "overdrive"]);
  });
});
