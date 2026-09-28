import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import ControlGroup from "./ControlGroup";
import OptionGroup from "./OptionGroup";
import Well from "./Well";

afterEach(() => cleanup());

describe("Well (#447)", () => {
  it("frames its drawing under a title, the live value and a scale", () => {
    const { container } = render(() => (
      <Well title="Amp envelope" value="ADSR" scale={["0", "1 s", "2 s"]}>
        <svg data-testid="drawing" />
      </Well>
    ));
    expect(screen.getByText("Amp envelope")).toBeInTheDocument();
    expect(screen.getByText("ADSR")).toBeInTheDocument();
    expect(container.querySelector(".well-screen")).toContainElement(
      screen.getByTestId("drawing"),
    );
    const scale = container.querySelector(".well-scale");
    expect(scale).toHaveAttribute("aria-hidden", "true");
    expect(scale?.textContent).toBe("01 s2 s");
  });

  it("leaves the value and scale out when there are none", () => {
    const { container } = render(() => (
      <Well title="Out">
        <svg />
      </Well>
    ));
    expect(container.querySelector(".well-value")).toBeNull();
    expect(container.querySelector(".well-scale")).toBeNull();
  });
});

describe("ControlGroup (#447)", () => {
  it("titles a row of controls", () => {
    const { container } = render(() => (
      <ControlGroup title="Filter">
        <span>Cutoff</span>
        <span>Resonance</span>
      </ControlGroup>
    ));
    expect(screen.getByRole("heading", { name: "Filter" })).toBeInTheDocument();
    expect(container.querySelector(".control-group-row")?.children).toHaveLength(2);
  });
});

describe("OptionGroup as a switch (#447)", () => {
  it("marks a filling group so its options share the height it is given", () => {
    const { container } = render(() => (
      <OptionGroup
        legend="Waveform"
        fill
        value="saw"
        options={[
          { value: "sine", label: "Sine" },
          { value: "saw", label: "Saw" },
        ]}
        onSelect={() => {}}
      />
    ));
    expect(container.querySelector(".option-group")).toHaveClass("fill");
    expect(screen.getByRole("radio", { name: "Saw" })).toBeChecked();
  });
});
