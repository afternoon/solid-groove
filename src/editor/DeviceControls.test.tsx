import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTarget, RawCommandInput, TransactionResult } from "../commands";
import { createDevice, deviceParameters } from "../domain/devices";
import type { Device } from "../domain/entities";
import type { DeviceId } from "../domain/ids";
import { moveTo, recordingGesture } from "../instrument/panelTesting";
import { fireAndFlush } from "../testing/events";
import DeviceControls from "./DeviceControls";

afterEach(() => cleanup());

const DEVICE_ID = "dev_ctrls0000000000000" as DeviceId;

function renderControls(device: Device = createDevice(DEVICE_ID, "overdrive", 0)) {
  const dispatched: RawCommandInput[] = [];
  const applied: RawCommandInput[] = [];
  const dispatch = vi.fn((commands: RawCommandInput | readonly RawCommandInput[]) => {
    dispatched.push(...(Array.isArray(commands) ? commands : [commands]));
    return { ok: true } as TransactionResult;
  });
  let gestures = 0;
  const beginGesture = vi.fn(() => {
    gestures += 1;
    return recordingGesture(applied);
  });
  const parameterTarget = (parameterId: string): ParameterTarget => ({
    scope: "masterDevice",
    deviceId: device.id,
    parameterId,
  });

  render(() => (
    <DeviceControls
      device={device}
      parameterTarget={parameterTarget}
      dispatch={dispatch}
      beginGesture={beginGesture}
    />
  ));
  return { dispatch, dispatched, applied, beginGesture, gestureCount: () => gestures };
}

describe("DeviceControls", () => {
  it("renders one control per registered parameter, in the registry's order", () => {
    renderControls();
    const labels = deviceParameters("overdrive").map((definition) => definition.label);
    expect(labels).toEqual(["Drive", "Tone", "Dry/Wet", "Output"]);
    for (const label of labels) {
      expect(screen.getByRole("slider", { name: label })).toBeInTheDocument();
    }
  });

  it("takes range, default and step from the definition, not from the view", () => {
    renderControls();
    const drive = screen.getByRole("slider", { name: "Drive" }) as HTMLInputElement;
    const definition = deviceParameters("overdrive")[0];
    expect(drive.min).toBe(String(definition.min));
    expect(drive.max).toBe(String(definition.max));
    // A device with no stored value for a parameter shows the definition's
    // default rather than 0 — `createDevice` fills the map, and a device that
    // predates a parameter falls back to the same place.
    expect(drive.value).toBe(String(definition.defaultValue));
  });

  it("shows a human-readable value, not the raw number", () => {
    renderControls();
    // `overdrive.drive` is normalized 0..1, so it reads as a percentage.
    expect(screen.getByRole("slider", { name: "Drive" })).toHaveAttribute(
      "aria-valuetext",
      "30%",
    );
    expect(screen.getByRole("slider", { name: "Output" })).toHaveAttribute(
      "aria-valuetext",
      "0 dB",
    );
  });

  it("commits a drag as one gesture, applying every step live", () => {
    const { applied, dispatched, gestureCount } = renderControls();
    const drive = screen.getByRole("slider", { name: "Drive" }) as HTMLInputElement;

    moveTo(drive, "0.5");
    moveTo(drive, "0.65");
    moveTo(drive, "0.8");
    fireAndFlush(() => {
      fireEvent.change(drive, { target: { value: "0.8" } });
    });

    // One gesture for the whole drag, every intermediate value applied inside
    // it so the sound follows the pointer, and nothing dispatched outside it.
    expect(gestureCount()).toBe(1);
    expect(applied).toHaveLength(3);
    expect(dispatched).toHaveLength(0);
    expect(applied.map((command) => command.payload)).toEqual([
      { target: target("drive"), value: 0.5 },
      { target: target("drive"), value: 0.65 },
      { target: target("drive"), value: 0.8 },
    ]);
  });

  it("labels a value driven to a bound instead of easing it back (FX-02)", () => {
    // The device is *stored* at the maximum, which is the state the panel has
    // to render honestly — the control shows the value it was given.
    const maxed: Device = {
      ...createDevice(DEVICE_ID, "overdrive", 0),
      parameters: { ...createDevice(DEVICE_ID, "overdrive", 0).parameters, drive: 1 },
    };
    renderControls(maxed);
    const drive = screen.getByRole("slider", { name: "Drive" }) as HTMLInputElement;
    expect(drive.value).toBe("1");
    expect(screen.getByText("at maximum")).toBeInTheDocument();
  });

  it("gives a stepped, non-automatable parameter its names rather than a slider", () => {
    renderControls(createDevice(DEVICE_ID, "filter", 0));
    // `filter.mode` is stored as an index; a slider through 0, 1, 2 says
    // nothing, so it is a choice between the modes' own names. Which names
    // those are is `deviceValue.test.ts`; that it is a choice at all is here.
    expect(screen.queryByRole("slider", { name: "Mode" })).not.toBeInTheDocument();
    const mode = screen.getByRole("combobox", { name: "Mode" }) as HTMLSelectElement;
    expect([...mode.options].map((option) => option.text)).toContain("Bandpass");
    expect(mode.value).toBe("0");
  });

  it("dispatches a discrete choice as one command with no gesture", () => {
    const device = createDevice(DEVICE_ID, "filter", 0);
    const { dispatched, gestureCount } = renderControls(device);
    fireAndFlush(() => {
      fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), {
        target: { value: "1" },
      });
    });
    expect(gestureCount()).toBe(0);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].payload).toEqual({
      target: {
        scope: "masterDevice",
        deviceId: DEVICE_ID,
        parameterId: "mode",
      },
      value: 1,
    });
  });

  it("stays legible for a device type the registry does not know", () => {
    // The audio layer gives an unregistered type an inert passthrough, so the
    // chain has to keep rendering rather than showing an unexplained gap.
    renderControls({
      id: DEVICE_ID,
      type: "mystery",
      order: 0,
      bypassed: false,
      parameters: {},
      preset: null,
    });
    expect(screen.getByText("This device has no controls.")).toBeInTheDocument();
  });
});

function target(parameterId: string) {
  return { scope: "masterDevice", deviceId: DEVICE_ID, parameterId };
}
