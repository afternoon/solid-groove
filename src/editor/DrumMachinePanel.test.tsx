import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import {
  CommandHistory,
  type RawCommandInput,
  type TransactionResult,
} from "../commands";
import type { DrumPad, Track } from "../domain/entities";
import { createDrumMachineFixtureProject } from "../domain/fixtures";
import type { PadId } from "../domain/ids";
import { fillExtent, moveTo, testAnalytics } from "../instrument/panelTesting";
import { fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import DrumMachinePanel from "./DrumMachinePanel";

afterEach(() => cleanup());

function drumTrackOf(project: ReturnType<typeof createDrumMachineFixtureProject>): Track {
  const track = project.song.tracks.find(
    (candidate) => candidate.instrument?.kind === "drumMachine",
  );
  if (!track) throw new Error("expected a drum-machine track in the fixture");
  return track;
}

function renderPanel() {
  const project = createDrumMachineFixtureProject();
  const track = drumTrackOf(project);
  const assets = project.song.assets.filter((asset) => asset.kind === "sample");
  const dispatch =
    vi.fn<
      (
        commands: RawCommandInput | readonly RawCommandInput[],
      ) => TransactionResult | undefined
    >();
  const audition = vi.fn<(padId: PadId) => void>();
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  render(() => (
    <DrumMachinePanel
      track={track}
      assets={assets}
      dispatch={dispatch}
      // No history behind this render: a control gesture that cannot open one
      // falls back to plain `dispatch`, which is what these assertions read.
      beginGesture={() => undefined}
      audition={audition}
      analytics={analytics}
    />
  ));
  return { project, track, assets, dispatch, audition, transport };
}

/**
 * The panel over a real command history, so a pad control's rendered value
 * comes back out of the project it edits — which is what a drag has to move,
 * and what one undo press has to put back.
 */
function renderLivePanel() {
  const history = new CommandHistory(createDrumMachineFixtureProject());
  const [project, setProject] = createSignal(history.project);
  history.subscribe(() => setProject(history.project));
  const track = () => drumTrackOf(project());
  const pad = (): DrumPad => {
    const instrument = track().instrument;
    if (instrument?.kind !== "drumMachine") throw new Error("expected a drum machine");
    return instrument.pads[0];
  };
  render(() => (
    <DrumMachinePanel
      track={track()}
      assets={project().song.assets.filter((asset) => asset.kind === "sample")}
      dispatch={(commands) => history.execute(commands)}
      beginGesture={(options) => history.beginGesture(options)}
      analytics={testAnalytics().analytics}
    />
  ));
  return { history, project, pad };
}

/**
 * Every range input the panel renders, in DOM order — pitch, level, pan per
 * pad. Selected structurally rather than by accessible name so the same helper
 * reads the raw inputs of the broken panel and the fill sliders of the fixed
 * one, and a red run can only mean the control itself is wrong.
 */
function rangeInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('.drum-machine input[type="range"]'),
  );
}

describe("DrumMachinePanel", () => {
  it("renders one named lane per pad with mute and solo controls", () => {
    const { track } = renderPanel();
    const padNames =
      track.instrument?.kind === "drumMachine"
        ? track.instrument.pads.map((pad) => pad.name)
        : [];
    for (const name of padNames) {
      expect(
        screen.getByRole("button", { name: `Audition ${name}` }),
      ).toBeInTheDocument();
    }
    // Each pad exposes a Mute and a Solo toggle, named for its pad.
    for (const name of padNames) {
      expect(screen.getByRole("button", { name: `Mute ${name}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Solo ${name}` })).toBeInTheDocument();
    }
  });

  it("dispatches drum.setPadAsset and logs instrument_changed on a sample replacement", () => {
    const { track, assets, dispatch, transport } = renderPanel();
    const selects = screen.getAllByRole("combobox");
    // The first pad's sample selector; pick a different asset than it holds.
    const firstPad =
      track.instrument?.kind === "drumMachine" ? track.instrument.pads[0] : undefined;
    const replacement = assets.find((asset) => asset.id !== firstPad?.assetId);
    expect(replacement).toBeDefined();

    fireEvent.change(selects[0], { target: { value: replacement?.id } });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const command = dispatch.mock.calls[0][0] as {
      type: string;
      payload: { assetId: string };
    };
    expect(command.type).toBe("drum.setPadAsset");
    expect(command.payload.assetId).toBe(replacement?.id);

    const instrumentChanged = transport.events.filter(
      (event) => event.name === "instrument_changed",
    );
    expect(instrumentChanged).toHaveLength(1);
    expect(instrumentChanged[0]?.params.instrument_type).toBe("drum_machine");
  });

  it("logs drum_machine feature_first_use exactly once across several interactions", () => {
    const { transport } = renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: /^Mute / })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Solo / })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Audition / })[0]);

    const featureEvents = transport.events.filter(
      (event) => event.name === "feature_first_use",
    );
    expect(featureEvents).toHaveLength(1);
    expect(featureEvents[0]?.params.feature).toBe("drum_machine");
  });

  it("toggles pad mute through a drum.setPadFlag command", () => {
    const { dispatch } = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: /^Mute / })[0]);

    const command = dispatch.mock.calls[0][0] as {
      type: string;
      payload: { flag: string; value: boolean };
    };
    expect(command.type).toBe("drum.setPadFlag");
    expect(command.payload.flag).toBe("muted");
    expect(command.payload.value).toBe(true);
  });

  // #255: the pad controls were raw `<input type="range">` — native track,
  // native thumb, no fill, no readout — beside the mixer's thumbless fill
  // sliders, and each pointer move dispatched a whole command of its own.
  it("paints every pad control as a thumbless fill slider (#255)", () => {
    renderPanel();
    const sliders = rangeInputs();
    expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) {
      // The fill track is what carries the value; a bare input has a thumb.
      expect(slider.closest(".fill-slider-track")).not.toBeNull();
      // The filled portion *is* the value, so it has a measurable extent…
      expect(fillExtent(slider)).not.toBe("");
      // …and the live value is written out beside it.
      const readout = slider.closest(".fill-slider")?.querySelector("output");
      expect(readout?.textContent ?? "").not.toBe("");
    }
  });

  it("runs one pad-level drag as one history entry and one revision (#255)", () => {
    const { history, project, pad } = renderLivePanel();
    const startRevision = project().metadata.revision;
    const restingLevel = pad().mixer.volume;
    // Pitch, level, pan — the first pad's level is the second control.
    const level = rangeInputs()[1];

    // Mid-drag: `input` has fired, `change` has not. The value still has to
    // follow the pointer, on screen and in the project the audio graph reads.
    moveTo(level, "-6");
    expect(pad().mixer.volume).toBeCloseTo(-6);
    moveTo(level, "-12");
    expect(pad().mixer.volume).toBeCloseTo(-12);
    // Nothing is committed until the drag ends.
    expect(history.entries).toHaveLength(0);

    fireAndFlush(() => {
      fireEvent.change(level, { target: { value: "-12" } });
    });
    expect(history.entries).toHaveLength(1);
    expect(project().metadata.revision).toBe(startRevision + 1);

    // …so a single undo puts the whole drag back.
    fireAndFlush(() => {
      history.undo();
    });
    expect(pad().mixer.volume).toBeCloseTo(restingLevel);
  });

  it("auditions a pad when its name button is clicked", () => {
    const { track, audition } = renderPanel();
    const firstPadName =
      track.instrument?.kind === "drumMachine" ? track.instrument.pads[0].name : "";
    fireEvent.click(screen.getByRole("button", { name: `Audition ${firstPadName}` }));
    expect(audition).toHaveBeenCalledTimes(1);
  });
});
