import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { RawCommandInput, TransactionResult } from "../commands";
import type { Instrument } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import { memoryStorage } from "../testing/storage";
import SynthPanel from "./SynthPanel";

afterEach(() => cleanup());

const TRACK_ID = "trk_synth" as TrackId;

function renderPanel(
  instrument: Extract<Instrument, { kind: "synth" }> = {
    kind: "synth",
    parameters: {},
  },
) {
  const dispatch = vi.fn<
    (
      commands: RawCommandInput | readonly RawCommandInput[],
    ) => TransactionResult | undefined
  >(() => ({ ok: true }) as TransactionResult);
  const audition = vi.fn();
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  render(() => (
    <SynthPanel
      trackId={TRACK_ID}
      instrument={instrument}
      dispatch={dispatch}
      audition={audition}
      analytics={analytics}
    />
  ));
  return { dispatch, audition, transport };
}

describe("SynthPanel", () => {
  it("renders the oscillator waveforms and amp/filter sliders", () => {
    renderPanel();
    expect(screen.getByRole("group", { name: "Waveform" })).toBeInTheDocument();
    // Amp ADSR + filter cutoff/resonance are the six fill-sliders.
    expect(screen.getByLabelText("Attack")).toBeInTheDocument();
    expect(screen.getByLabelText("Cutoff")).toBeInTheDocument();
    expect(screen.getByLabelText("Resonance")).toBeInTheDocument();
  });

  it("dispatches a validated instrument parameter.set when a slider commits", () => {
    const { dispatch } = renderPanel();
    const cutoff = screen.getByLabelText("Cutoff") as HTMLInputElement;
    fireEvent.input(cutoff, { target: { value: "5000" } });
    fireEvent.change(cutoff, { target: { value: "5000" } });

    // Exactly one command, on commit — not one per input tick.
    expect(dispatch).toHaveBeenCalledTimes(1);
    const command = dispatch.mock.calls[0][0] as {
      type: string;
      payload: {
        target: { scope: string; parameterId: string };
        value: number;
      };
    };
    expect(command.type).toBe("parameter.set");
    expect(command.payload.target.scope).toBe("instrument");
    expect(command.payload.target.parameterId).toBe("filterCutoff");
  });

  it("selecting a waveform dispatches its index", () => {
    const { dispatch } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /Square/ }));
    const command = dispatch.mock.calls.at(-1)?.[0] as {
      payload: { target: { parameterId: string }; value: number };
    };
    expect(command.payload.target.parameterId).toBe("waveform");
    expect(command.payload.value).toBe(1); // square is index 1
  });

  it("emits the synth feature_first_use exactly once across many edits", () => {
    const { transport } = renderPanel();
    const cutoff = screen.getByLabelText("Cutoff") as HTMLInputElement;
    for (const value of ["2000", "3000", "4000"]) {
      fireEvent.input(cutoff, { target: { value } });
      fireEvent.change(cutoff, { target: { value } });
    }
    expect(
      transport.named("feature_first_use").filter((e) => e.params.feature === "synth"),
    ).toHaveLength(1);
  });

  it("emits nothing per input tick before the gesture commits", () => {
    const { dispatch, transport } = renderPanel();
    const cutoff = screen.getByLabelText("Cutoff") as HTMLInputElement;
    // Three moves, no commit yet.
    fireEvent.input(cutoff, { target: { value: "1000" } });
    fireEvent.input(cutoff, { target: { value: "2000" } });
    fireEvent.input(cutoff, { target: { value: "3000" } });
    expect(dispatch).not.toHaveBeenCalled();
    expect(transport.events).toHaveLength(0);
  });

  it("auditions on the audition button", () => {
    const { audition } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Audition" }));
    expect(audition).toHaveBeenCalledTimes(1);
  });
});
