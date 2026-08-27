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
import { readInstrumentParameter, SAMPLER_PITCH } from "../domain/parameters";
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
  const audition = vi.fn();
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
      audition={audition}
      analytics={analytics}
    />
  ));
  return { dispatch, applied, audition, transport };
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
      audition={() => {}}
      analytics={testAnalytics().analytics}
    />
  ));
  return { history, project, instrument };
}

describe("SamplerPanel", () => {
  it("renders the sample name, playback, and amp-envelope sliders", () => {
    renderPanel();
    expect(screen.getByText("Clap", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pitch")).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toBeInTheDocument();
    expect(screen.getByLabelText("End")).toBeInTheDocument();
    expect(screen.getByLabelText("Attack")).toBeInTheDocument();
  });

  it("says so when it is holding nothing, and how to fill it", () => {
    renderPanel({ kind: "sampler", assetId: null, parameters: {} }, null);
    expect(screen.getByText("No sample loaded")).toBeInTheDocument();
    expect(screen.getByText("Drag a sound here from the library")).toBeInTheDocument();
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
    expect(screen.getByText("0 st")).toBeInTheDocument();
    const restingFill = fillExtent(pitch);

    // Mid-drag: `input` has fired, `change` has not.
    moveTo(pitch, "5");
    expect(screen.getByText("+5 st")).toBeInTheDocument();
    expect(fillExtent(pitch)).not.toBe(restingFill);
    // The audio graph reads the same project state, so the pitch is audible.
    expect(readInstrumentParameter(SAMPLER_PITCH, instrument().parameters)).toBe(5);

    moveTo(pitch, "7");
    expect(screen.getByText("+7 st")).toBeInTheDocument();
    expect(history.entries).toHaveLength(0);

    // One drag = one history entry and one revision, however many moves it took.
    fireAndFlush(() => {
      fireEvent.change(pitch, { target: { value: "7" } });
    });
    expect(history.entries).toHaveLength(1);
    expect(project().metadata.revision).toBe(startRevision + 1);
    expect(readInstrumentParameter(SAMPLER_PITCH, instrument().parameters)).toBe(7);
  });

  it("auditions on the audition button", () => {
    const { audition } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Audition" }));
    expect(audition).toHaveBeenCalledTimes(1);
  });
});
