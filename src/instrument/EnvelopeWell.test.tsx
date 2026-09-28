import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RawCommandInput } from "../commands";
import {
  type ParameterDefinition,
  SYNTH_AMP_ATTACK,
  SYNTH_AMP_DECAY,
  SYNTH_AMP_RELEASE,
  SYNTH_AMP_SUSTAIN,
} from "../domain/parameters";
import EnvelopeWell from "./EnvelopeWell";
import { envelopePoints } from "./envelopeGeometry";
import { recordingGesture } from "./panelTesting";

afterEach(() => cleanup());

const times = { attack: 0.005, decay: 0.18, sustain: 0.6, release: 0.22 };

function renderWell() {
  const applied: RawCommandInput[] = [];
  const { container } = render(() => (
    <EnvelopeWell
      definitions={{
        attack: SYNTH_AMP_ATTACK,
        decay: SYNTH_AMP_DECAY,
        sustain: SYNTH_AMP_SUSTAIN,
        release: SYNTH_AMP_RELEASE,
      }}
      times={times}
      command={(definition: ParameterDefinition, value: number) =>
        ({
          type: "set",
          payload: { id: definition.id, value },
        }) as unknown as RawCommandInput
      }
      dispatch={() => undefined}
      beginGesture={() => recordingGesture(applied)}
    />
  ));
  const surface = container.querySelector(".drag-surface") as HTMLElement;
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100 }) as DOMRect;
  const press = (x: number, y: number) =>
    fireEvent(
      surface,
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: x * 300,
        clientY: (1 - y) * 100,
      }),
    );
  return { container, applied, press };
}

const ids = (applied: RawCommandInput[]) =>
  applied.map(
    (command) => (command as unknown as { payload: { id: string } }).payload.id,
  );

describe("EnvelopeWell (#447)", () => {
  it("draws the envelope and a handle on each of its three corners", () => {
    const { container } = renderWell();
    expect(container.querySelector(".well-line")?.getAttribute("d")).toMatch(/^M0\.0,/);
    expect(container.querySelectorAll(".drag-handle")).toHaveLength(3);
    expect(container.querySelector(".drag-surface")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("sets attack from the peak", () => {
    const { applied, press } = renderWell();
    const [, peak] = envelopePoints(times, SYNTH_AMP_ATTACK.max);
    press(peak[0], peak[1]);
    expect(ids(applied)).toEqual([SYNTH_AMP_ATTACK.id]);
  });

  it("sets decay and sustain from the next corner, release and sustain from the last", () => {
    const decay = renderWell();
    const points = envelopePoints(times, SYNTH_AMP_ATTACK.max);
    decay.press(points[2][0], points[2][1]);
    expect(ids(decay.applied)).toEqual([SYNTH_AMP_DECAY.id, SYNTH_AMP_SUSTAIN.id]);
    cleanup();

    const release = renderWell();
    release.press(points[3][0], points[3][1]);
    expect(ids(release.applied)).toEqual([SYNTH_AMP_RELEASE.id, SYNTH_AMP_SUSTAIN.id]);
  });
});
