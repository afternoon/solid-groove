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
import { createSliceFixtureProject } from "../domain/fixtures";
import type { AssetId, TrackId } from "../domain/ids";
import {
  readInstrumentParameter,
  SAMPLER_PITCH,
  SAMPLER_SAMPLE_START,
} from "../domain/parameters";
import { fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import { fillExtent, moveTo, recordingGesture, testAnalytics } from "./panelTesting";
import SamplerPanel from "./SamplerPanel";

afterEach(() => cleanup());

const TRACK_ID = "trk_sampler" as TrackId;
const ASSET_A = "ast_a" as AssetId;

function renderPanel(
  instrument: Extract<Instrument, { kind: "sampler" }> = {
    kind: "sampler",
    assetId: ASSET_A,
    parameters: {},
  },
  sampleName: string | null = "Clap",
) {
  const dispatch = vi.fn<
    (
      commands: RawCommandInput | readonly RawCommandInput[],
    ) => TransactionResult | undefined
  >(() => ({ ok: true }) as TransactionResult);
  const onBrowse = vi.fn();
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
    <SamplerPanel
      trackId={TRACK_ID}
      instrument={instrument}
      sampleName={sampleName}
      dispatch={dispatch}
      beginGesture={(): Gesture => recordingGesture(applied)}
      onBrowse={onBrowse}
      analytics={analytics}
    />
  ));
  return { dispatch, applied, onBrowse, transport };
}

/**
 * The panel over a real command history, so the slider's `value` comes back
 * out of the project it edits — which is what a drag has to move.
 */
function renderLivePanel() {
  const history = new CommandHistory(createSliceFixtureProject());
  const [project, setProject] = createSignal(history.project);
  history.subscribe(() => setProject(history.project));
  const track = () => project().song.tracks[0];
  const instrument = () => track().instrument as Extract<Instrument, { kind: "sampler" }>;
  render(() => (
    <SamplerPanel
      trackId={track().id}
      instrument={instrument()}
      sampleName="909 Bass Drum"
      dispatch={(commands) => history.execute(commands)}
      beginGesture={(options) => history.beginGesture(options)}
      analytics={testAnalytics().analytics}
    />
  ));
  return { history, project, instrument };
}

describe("SamplerPanel", () => {
  it("renders the sample name, playback, and amp-envelope sliders", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Sample" })).toHaveTextContent("Clap");
    expect(screen.getByLabelText("Pitch")).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toBeInTheDocument();
    expect(screen.getByLabelText("End")).toBeInTheDocument();
    expect(screen.getByLabelText("Attack")).toBeInTheDocument();
  });

  it("says so when it is holding nothing, and how to fill it", () => {
    renderPanel({ kind: "sampler", assetId: null, parameters: {} }, null);
    expect(screen.getByText("No sample loaded")).toBeInTheDocument();
    // The slot is the way into the library (UI-001), not a hint about a drag.
    expect(screen.getByRole("button", { name: "Sample" })).toBeInTheDocument();
  });

  it("opens the library from its sample slot", () => {
    const { onBrowse } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Sample" }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("dispatches an instrument parameter.set once when a slider commits", () => {
    const { applied, transport } = renderPanel();
    const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;
    fireEvent.input(pitch, { target: { value: "5" } });
    fireEvent.change(pitch, { target: { value: "5" } });

    expect(applied).toHaveLength(1);
    const command = applied[0] as {
      type: string;
      payload: { target: { scope: string; parameterId: string } };
    };
    expect(command.type).toBe("parameter.set");
    expect(command.payload.target.scope).toBe("instrument");
    expect(command.payload.target.parameterId).toBe("pitch");
    // No instrument_changed for a plain parameter edit.
    expect(transport.named("instrument_changed")).toHaveLength(0);
  });

  it("emits nothing per input tick before a slider commits", () => {
    const { dispatch, transport } = renderPanel();
    const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;
    fireEvent.input(pitch, { target: { value: "1" } });
    fireEvent.input(pitch, { target: { value: "2" } });
    expect(dispatch).not.toHaveBeenCalled();
    expect(transport.events).toHaveLength(0);
  });

  it("follows the pointer mid-drag, and still commits once (#254)", () => {
    const { history, project, instrument } = renderLivePanel();
    const startRevision = project().metadata.revision;
    const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;
    expect(screen.getByDisplayValue("0 st")).toBeInTheDocument();
    const restingFill = fillExtent(pitch);

    // Mid-drag: `input` has fired, `change` has not.
    moveTo(pitch, "5");
    expect(screen.getByDisplayValue("+5 st")).toBeInTheDocument();
    expect(fillExtent(pitch)).not.toBe(restingFill);
    // The audio graph reads the same project state, so the pitch is audible.
    expect(readInstrumentParameter(SAMPLER_PITCH, instrument().parameters)).toBe(5);

    moveTo(pitch, "7");
    expect(screen.getByDisplayValue("+7 st")).toBeInTheDocument();
    expect(history.entries).toHaveLength(0);

    // One drag = one history entry and one revision, however many moves it took.
    fireAndFlush(() => {
      fireEvent.change(pitch, { target: { value: "7" } });
    });
    expect(history.entries).toHaveLength(1);
    expect(project().metadata.revision).toBe(startRevision + 1);
    expect(readInstrumentParameter(SAMPLER_PITCH, instrument().parameters)).toBe(7);
  });

  // The orphan half of the same defect: a drag that ends without a `change`
  // (released off-element, or the panel unmounted by a track switch) used to
  // leave its gesture open forever, and the next control touched anywhere in
  // the editor threw out of its own `input` handler and locked up.
  it("commits its gesture on pointer-up, with no change event (#254)", () => {
    const { history } = renderLivePanel();
    const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;

    moveTo(pitch, "5");
    expect(history.gestureActive).toBe(true);

    fireEvent.pointerUp(pitch);
    expect(history.gestureActive).toBe(false);
    expect(history.entries).toHaveLength(1);
  });
});

describe("SamplerPanel faceplate (#447)", () => {
  it("sets the sample's start by dragging its marker, as one history entry", () => {
    const { history, instrument } = renderLivePanel();
    const surface = document.querySelector(".sample-well .drag-surface") as HTMLElement;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100 }) as DOMRect;
    const pointer = (type: string, x: number) =>
      fireAndFlush(() =>
        fireEvent(
          surface,
          new MouseEvent(type, { bubbles: true, clientX: x, clientY: 50 }),
        ),
      );
    const entries = history.entries.length;

    pointer("pointerdown", 20);
    pointer("pointermove", 100);
    pointer("pointerup", 100);

    expect(
      readInstrumentParameter(SAMPLER_SAMPLE_START, instrument().parameters),
    ).toBeCloseTo(0.25);
    expect(history.entries.length).toBe(entries + 1);
  });

  it("draws the envelope in a well over the ADSR faders", () => {
    renderPanel();
    expect(document.querySelectorAll(".envelope-well .drag-handle")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Amp envelope" })).toBeInTheDocument();
  });
});
