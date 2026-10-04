import { cleanup, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { ControlAddress } from "../commands/controlAddress";
import { ControlRegistryContext, control } from "./control";
import { createControlRegistry } from "./registry";

afterEach(cleanup);

const VOLUME: ControlAddress = { entity: "trk_a", param: "volume" };
const PAN: ControlAddress = { entity: "trk_a", param: "pan" };

function Part(props: { address: ControlAddress | undefined; testId?: string }) {
  return <div data-testid={props.testId ?? "part"} ref={control(() => props.address)} />;
}

describe("control() (UI-004)", () => {
  it("registers the element it is put on, and leaves when it unmounts", () => {
    const registry = createControlRegistry();
    const [shown, setShown] = createSignal(true);
    const { getByTestId } = render(() => (
      <ControlRegistryContext value={registry}>
        {shown() && <Part address={VOLUME} />}
      </ControlRegistryContext>
    ));
    const part = getByTestId("part");
    expect(registry.elementsFor(VOLUME)).toEqual([part]);
    expect(part.dataset.control).toBe("trk_a:volume");

    setShown(false);
    flush();
    expect(registry.elementsFor(VOLUME)).toEqual([]);
  });

  it("puts no wrapper around the control", () => {
    const registry = createControlRegistry();
    const { container } = render(() => (
      <ControlRegistryContext value={registry}>
        <Part address={VOLUME} />
      </ControlRegistryContext>
    ));
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.getAttribute("data-testid")).toBe("part");
  });

  it("holds every element that shows one address", () => {
    const registry = createControlRegistry();
    const { getByTestId } = render(() => (
      <ControlRegistryContext value={registry}>
        <Part address={VOLUME} testId="strip" />
        <Part address={VOLUME} testId="header" />
      </ControlRegistryContext>
    ));
    expect(registry.elementsFor(VOLUME)).toEqual([
      getByTestId("strip"),
      getByTestId("header"),
    ]);
  });

  it("re-registers when its address changes", () => {
    const registry = createControlRegistry();
    const [address, setAddress] = createSignal<ControlAddress>(VOLUME);
    const { getByTestId } = render(() => (
      <ControlRegistryContext value={registry}>
        <Part address={address()} />
      </ControlRegistryContext>
    ));
    setAddress(PAN);
    flush();
    expect(registry.elementsFor(VOLUME)).toEqual([]);
    expect(registry.elementsFor(PAN)).toEqual([getByTestId("part")]);
    expect(getByTestId("part").dataset.control).toBe("trk_a:pan");
  });

  it("draws the address's mark, and only on that address's controls", () => {
    const registry = createControlRegistry();
    const { getByTestId } = render(() => (
      <ControlRegistryContext value={registry}>
        <Part address={VOLUME} testId="volume" />
        <Part address={PAN} testId="pan" />
      </ControlRegistryContext>
    ));
    const volume = getByTestId("volume");
    const pan = getByTestId("pan");
    expect(volume.dataset.controlMark).toBeUndefined();

    registry.setMark(VOLUME, "previewed");
    flush();
    expect(volume.dataset.controlMark).toBe("previewed");
    expect(pan.dataset.controlMark).toBeUndefined();

    registry.setMark([VOLUME, PAN], "changed");
    flush();
    expect(volume.dataset.controlMark).toBe("changed");
    expect(pan.dataset.controlMark).toBe("changed");

    registry.setMark(PAN, "none");
    flush();
    expect(pan.dataset.controlMark).toBeUndefined();

    registry.clearMarks();
    flush();
    expect(volume.dataset.controlMark).toBeUndefined();
  });

  it("gives a control that mounts later the mark already set on its address", () => {
    const registry = createControlRegistry();
    registry.setMark(VOLUME, "changed");
    const { getByTestId } = render(() => (
      <ControlRegistryContext value={registry}>
        <Part address={VOLUME} />
      </ControlRegistryContext>
    ));
    expect(getByTestId("part").dataset.controlMark).toBe("changed");
  });

  it("registers nowhere, and does not throw, outside an editor", () => {
    const { getByTestId } = render(() => <Part address={VOLUME} />);
    expect(getByTestId("part").dataset.control).toBe("trk_a:volume");
    expect(getByTestId("part").dataset.controlMark).toBeUndefined();
  });

  it("leaves a part with no address alone", () => {
    const registry = createControlRegistry();
    const { getByTestId } = render(() => (
      <ControlRegistryContext value={registry}>
        <Part address={undefined} />
      </ControlRegistryContext>
    ));
    expect(getByTestId("part").dataset.control).toBeUndefined();
  });
});
