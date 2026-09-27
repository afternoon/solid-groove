import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RawCommandInput } from "../commands";
import {
  type ParameterDefinition,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
} from "../domain/parameters";
import FilterWell from "./FilterWell";
import { recordingGesture } from "./panelTesting";

afterEach(() => cleanup());

describe("FilterWell (#447)", () => {
  it("sets cutoff on the log axis and resonance by height, in one drag", () => {
    const applied: RawCommandInput[] = [];
    const { container } = render(() => (
      <FilterWell
        shape="lowpass"
        cutoff={SYNTH_FILTER_CUTOFF}
        resonance={SYNTH_FILTER_RESONANCE}
        values={{ cutoff: 1000, resonance: 1 }}
        readout="1 kHz · Q 1"
        command={(definition: ParameterDefinition, value: number) =>
          ({ id: definition.id, value }) as unknown as RawCommandInput
        }
        dispatch={() => undefined}
        beginGesture={() => recordingGesture(applied)}
      />
    ));
    expect(container.textContent).toContain("1 kHz · Q 1");
    const surface = container.querySelector(".drag-surface") as HTMLElement;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100 }) as DOMRect;

    fireEvent(
      surface,
      new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 50 }),
    );

    expect(applied).toEqual([
      { id: SYNTH_FILTER_CUTOFF.id, value: expect.closeTo(200, 5) },
      { id: SYNTH_FILTER_RESONANCE.id, value: SYNTH_FILTER_RESONANCE.max / 2 },
    ]);
  });
});
