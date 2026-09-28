import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import {
  CommandHistory,
  type Gesture,
  type RawCommandInput,
  type TransactionResult,
} from "../commands";
import type { Instrument } from "../domain/entities";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import type { TrackId } from "../domain/ids";
import {
  readInstrumentParameter,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
} from "../domain/parameters";
import { fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import { fillExtent, moveTo, recordingGesture, testAnalytics } from "./panelTesting";
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
  const applied: RawCommandInput[] = [];
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
      beginGesture={(): Gesture => recordingGesture(applied)}
      analytics={analytics}
    />
  ));
  return { dispatch, applied, transport };
}

/**
 * The panel over a real command history, so the slider's `value` comes back
 * out of the project it edits — which is what a drag has to move.
 */
function renderLivePanel() {
  const history = new CommandHistory(createPianoRollFixtureProject());
  const [project, setProject] = createSignal(history.project);
  history.subscribe(() => setProject(history.project));
  const track = () => project().song.tracks[0];
  const instrument = () => track().instrument as Extract<Instrument, { kind: "synth" }>;
  render(() => (
    <SynthPanel
      trackId={track().id}
      instrument={instrument()}
      dispatch={(commands) => history.execute(commands)}
      beginGesture={(options) => history.beginGesture(options)}
      analytics={testAnalytics().analytics}
    />
  ));
  return { history, project, instrument };
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
    const { applied } = renderPanel();
    const cutoff = screen.getByLabelText("Cutoff") as HTMLInputElement;
    fireEvent.input(cutoff, { target: { value: "5000" } });
    fireEvent.change(cutoff, { target: { value: "5000" } });

    // Exactly one command for the drag — not one per input tick.
    expect(applied).toHaveLength(1);
    const command = applied[0] as {
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

  it("follows the pointer mid-drag, and still commits once (#254)", () => {
    const { history, project, instrument } = renderLivePanel();
    const startRevision = project().metadata.revision;
    const cutoff = screen.getByLabelText("Cutoff") as HTMLInputElement;
    expect(screen.getByDisplayValue("4 kHz")).toBeInTheDocument();
    const restingFill = fillExtent(cutoff);

    // Mid-drag: `input` has fired, `change` has not.
    moveTo(cutoff, "760");
    expect(screen.getByDisplayValue("760 Hz")).toBeInTheDocument();
    expect(fillExtent(cutoff)).not.toBe(restingFill);
    // The audio graph reads the same project state, so the sweep is audible.
    expect(readInstrumentParameter(SYNTH_FILTER_CUTOFF, instrument().parameters)).toBe(
      760,
    );

    moveTo(cutoff, "400");
    expect(screen.getByDisplayValue("400 Hz")).toBeInTheDocument();
    expect(history.entries).toHaveLength(0);

    // One drag = one history entry and one revision, however many moves it took.
    fireAndFlush(() => {
      fireEvent.change(cutoff, { target: { value: "400" } });
    });
    expect(history.entries).toHaveLength(1);
    expect(project().metadata.revision).toBe(startRevision + 1);
    expect(readInstrumentParameter(SYNTH_FILTER_CUTOFF, instrument().parameters)).toBe(
      400,
    );
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
});

describe("SynthPanel faceplate (#447)", () => {
  it("draws the oscillator, filter and envelope in wells over their controls", () => {
    renderPanel();
    const container = document.body;
    expect(container.querySelector(".oscillator-well")?.textContent).toContain(
      "Sawtooth",
    );
    expect(container.querySelector(".filter-well .well-line")).not.toBeNull();
    expect(container.querySelectorAll(".envelope-well .drag-handle")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Low-pass filter" })).toBeInTheDocument();
  });

  it("drags cutoff and resonance together as one history entry", () => {
    const { history, instrument } = renderLivePanel();
    const surface = document.querySelector(".filter-well .drag-surface") as HTMLElement;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100 }) as DOMRect;
    const pointer = (type: string, x: number, y: number) =>
      fireAndFlush(() =>
        fireEvent(
          surface,
          new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }),
        ),
      );
    const entries = history.entries.length;

    pointer("pointerdown", 150, 50);
    pointer("pointermove", 200, 25);
    pointer("pointerup", 200, 25);

    const cutoff = readInstrumentParameter(SYNTH_FILTER_CUTOFF, instrument().parameters);
    const resonance = readInstrumentParameter(
      SYNTH_FILTER_RESONANCE,
      instrument().parameters,
    );
    expect(cutoff).toBeCloseTo(20 * 1000 ** (2 / 3), 0);
    expect(resonance).toBeCloseTo(SYNTH_FILTER_RESONANCE.max * 0.75);
    expect(history.entries.length).toBe(entries + 1);
  });
});
