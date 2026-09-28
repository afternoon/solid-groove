import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SYNTH_FILTER_CUTOFF } from "../domain/parameters";
import FillSlider from "./FillSlider";
import { formatInstrumentValue } from "./formatValue";

afterEach(() => cleanup());

/** One slider over a live value, as a panel would hold it. */
function renderSlider(start = 1000) {
  const onInput = vi.fn();
  const onCommit = vi.fn();
  const [value, setValue] = createSignal(start);
  render(() => (
    <FillSlider
      definition={SYNTH_FILTER_CUTOFF}
      value={value()}
      displayValue={formatInstrumentValue(SYNTH_FILTER_CUTOFF, value())}
      onInput={(next) => {
        onInput(next);
        setValue(next);
      }}
      onCommit={onCommit}
    />
  ));
  const field = screen.getByLabelText("Cutoff value") as HTMLInputElement;
  return { onInput, onCommit, field };
}

describe("FillSlider value field (#447)", () => {
  it("shows the live value in a field beside the slider", () => {
    const { field } = renderSlider(760);
    expect(field.value).toBe("760 Hz");
    // It is a text field, not a second slider: flows find sliders by name.
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Cutoff value" })).toBe(field);
  });

  it("lands a typed value as one input and one commit", () => {
    const { field, onInput, onCommit } = renderSlider();
    field.value = "2.4k";
    fireEvent.change(field);

    expect(onInput).toHaveBeenCalledExactlyOnceWith(2400);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2400);
    flush();
    expect(field.value).toBe("2.4 kHz");
  });

  it("clamps a typed value into the range, as a drag past the end does", () => {
    const { field, onCommit } = renderSlider();
    field.value = "99k";
    fireEvent.change(field);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(SYNTH_FILTER_CUTOFF.max);
  });

  it("refuses what is not a value and shows the live value again", () => {
    const { field, onInput, onCommit } = renderSlider();
    field.value = "loud";
    fireEvent.change(field);

    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.value).toBe("1 kHz");
  });

  it("reads the text with the caller's parser when the slider has its own space", () => {
    const onCommit = vi.fn();
    render(() => (
      <FillSlider
        definition={SYNTH_FILTER_CUTOFF}
        value={0.5}
        displayValue="half"
        range={{ min: 0, max: 1 }}
        parseEntry={(text) => (text === "top" ? 1 : null)}
        onInput={() => {}}
        onCommit={onCommit}
      />
    ));
    const field = screen.getByLabelText("Cutoff value") as HTMLInputElement;
    field.value = "top";
    fireEvent.change(field);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
