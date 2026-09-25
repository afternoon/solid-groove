import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, createStore, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { createSliceFixtureProject } from "../domain/fixtures";
import { TICKS_PER_BAR, TICKS_PER_QUARTER } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import EditorHeader, { type HeaderAudio, type HeaderSession } from "./EditorHeader";
import type { EditorSessionState } from "./useEditorSession";

afterEach(cleanup);

/** A fake audio module: real signals behind the accessors, spies for the verbs. */
function fakeAudio() {
  const [isPlaying, setPlaying] = createSignal(false);
  const [positionTicks, setPositionTicks] = createSignal(0);
  const [loopEnabled, setLoopEnabled] = createSignal(false);
  const [metronomeEnabled, setMetronomeEnabled] = createSignal(false);
  const audio: HeaderAudio = {
    isPlaying,
    positionTicks,
    loopEnabled,
    metronomeEnabled,
    toggle: vi.fn(async () => {
      setPlaying((playing) => !playing);
    }),
    toggleMetronome: vi.fn(() => setMetronomeEnabled((on) => !on)),
    seekTicks: vi.fn((ticks: number) => setPositionTicks(ticks)),
  };
  const toggleLoop = vi.fn(() => setLoopEnabled((on) => !on));
  return { audio, setPositionTicks, toggleLoop };
}

/** A fake session: a store for the state the header reads, spies for the verbs. */
function fakeSession(overrides: Partial<EditorSessionState> = {}) {
  const [state, setState] = createStore<{
    -readonly [K in keyof EditorSessionState]: EditorSessionState[K];
  }>({
    loading: false,
    notFound: false,
    error: null,
    project: createSliceFixtureProject(),
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    saveStatus: null,
    ...overrides,
  });
  const session: HeaderSession = {
    state,
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
    retry: vi.fn(() => undefined),
  };
  return { session, setState };
}

/** A real `Analytics` over a recording transport, as `Mixer.test.tsx` builds it. */
function recordingAnalytics() {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
  analytics.setAccountType("anonymous");
  return { analytics, consent, transport };
}

function renderHeader(
  session: HeaderSession,
  audio: HeaderAudio,
  onToggleLoop: () => void = () => {},
  analytics: Analytics = recordingAnalytics().analytics,
) {
  return render(() => (
    <EditorHeader
      projectName="Untitled"
      session={session}
      audio={audio}
      onToggleLoop={onToggleLoop}
      tempo={() => 120}
      onTempoChange={() => {}}
      onOpenGuide={() => {}}
      keyHint={() => "K"}
      analytics={analytics}
    />
  ));
}

describe("EditorHeader", () => {
  it("drives the audio module it is handed and tracks its accessors", async () => {
    const { audio, setPositionTicks, toggleLoop } = fakeAudio();
    renderHeader(fakeSession().session, audio, toggleLoop);

    fireEvent.click(screen.getByRole("button", { name: "Start playback" }));
    expect(audio.toggle).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "Stop playback" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable loop" }));
    expect(toggleLoop).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("button", { name: "Disable loop" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enable metronome" }));
    expect(
      await screen.findByRole("button", { name: "Disable metronome" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Playhead at bar 1.1")).toBeInTheDocument();
    setPositionTicks(192 * 5);
    flush();
    expect(screen.getByText("Playhead at bar 2.2")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Bar" })).toHaveValue(2);
    expect(screen.getByRole("spinbutton", { name: "Beat" })).toHaveValue(2);
  });

  it("reads history from the session and routes undo/redo back to it", () => {
    const { session, setState } = fakeSession();
    renderHeader(session, fakeAudio().audio);

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();

    setState((draft) => {
      draft.canUndo = true;
      draft.undoSummary = "add note";
      draft.canRedo = true;
    });
    flush();
    const enabledUndo = screen.getByRole("button", { name: "Undo add note" });
    expect(enabledUndo).toBeEnabled();
    fireEvent.click(enabledUndo);
    expect(session.undo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(session.redo).toHaveBeenCalledOnce();
  });

  it("groups the controls into start, centre, and end sections", () => {
    const { container } = renderHeader(fakeSession().session, fakeAudio().audio);
    const start = container.querySelector(".editor-header-start");
    const center = container.querySelector(".editor-header-center");
    const end = container.querySelector(".editor-header-end");

    expect(start).toContainElement(screen.getByRole("link", { name: "Projects" }));
    expect(start).toContainElement(screen.getByRole("heading", { name: "Untitled" }));
    for (const name of [
      "Undo",
      "Redo",
      "Start playback",
      "Enable loop",
      "Enable metronome",
    ]) {
      expect(center).toContainElement(screen.getByRole("button", { name }));
    }
    expect(center).toContainElement(
      screen.getByRole("spinbutton", { name: "Tempo (BPM)" }),
    );
    expect(center).toContainElement(screen.getByRole("group", { name: "Playhead" }));
    expect(end).toContainElement(
      screen.getByRole("button", { name: "Keyboard shortcuts" }),
    );
  });

  it("drops the time signature and the printed BPM suffix", () => {
    const { container } = renderHeader(fakeSession().session, fakeAudio().audio);
    expect(container.querySelector(".time-signature")).toBeNull();
    expect(screen.queryByText("4/4", { exact: false })).toBeNull();
    expect(screen.queryByText("BPM")).toBeNull();
  });

  it("seeks to a bar and beat typed into the playhead", () => {
    const { audio } = fakeAudio();
    renderHeader(fakeSession().session, audio);

    // Each step is its own browser event; Solid settles writes between them.
    const type = (name: string, value: string) => {
      const field = screen.getByRole("spinbutton", { name });
      fireEvent.focus(field);
      flush();
      fireEvent.change(field, { target: { value } });
      flush();
      fireEvent.blur(field);
      flush();
    };

    type("Bar", "3");
    expect(audio.seekTicks).toHaveBeenLastCalledWith(TICKS_PER_BAR * 2);
    type("Beat", "4");
    expect(audio.seekTicks).toHaveBeenLastCalledWith(
      TICKS_PER_BAR * 2 + TICKS_PER_QUARTER * 3,
    );
    expect(screen.getByText("Playhead at bar 3.4")).toBeInTheDocument();
  });

  it("keeps a committed segment while its neighbour is still being edited", () => {
    const { audio } = fakeAudio();
    renderHeader(fakeSession().session, audio);

    // Enter commits without blurring, so the hold has to move with the seek
    // or the next commit would pair the new beat with the old bar.
    const bar = screen.getByRole("spinbutton", { name: "Bar" });
    fireEvent.focus(bar);
    flush();
    fireEvent.change(bar, { target: { value: "3" } });
    flush();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Beat" }), {
      target: { value: "2" },
    });
    expect(audio.seekTicks).toHaveBeenLastCalledWith(
      TICKS_PER_BAR * 2 + TICKS_PER_QUARTER,
    );
  });

  it("clamps a typed position and ignores an emptied segment", () => {
    const { audio } = fakeAudio();
    renderHeader(fakeSession().session, audio);

    const beat = screen.getByRole("spinbutton", { name: "Beat" });
    fireEvent.change(beat, { target: { value: "9" } });
    expect(audio.seekTicks).toHaveBeenLastCalledWith(TICKS_PER_QUARTER * 3);
    expect(beat).toHaveValue(4);

    const bar = screen.getByRole("spinbutton", { name: "Bar" });
    fireEvent.change(bar, { target: { value: "" } });
    expect(audio.seekTicks).toHaveBeenCalledOnce();
    expect(bar).toHaveValue(1);
  });

  it("holds the shown position while a segment is being edited", () => {
    const { audio, setPositionTicks } = fakeAudio();
    renderHeader(fakeSession().session, audio);

    const bar = screen.getByRole("spinbutton", { name: "Bar" });
    fireEvent.focus(bar);
    flush();
    setPositionTicks(TICKS_PER_BAR * 6);
    flush();
    expect(bar).toHaveValue(1);
    fireEvent.blur(bar);
    flush();
    expect(bar).toHaveValue(7);
  });

  it("marks playhead_seek as first used once, and seeks with analytics off", () => {
    const { analytics, transport } = recordingAnalytics();
    const { audio } = fakeAudio();
    renderHeader(fakeSession().session, audio, () => {}, analytics);

    const bar = screen.getByRole("spinbutton", { name: "Bar" });
    fireEvent.change(bar, { target: { value: "2" } });
    fireEvent.change(bar, { target: { value: "5" } });
    expect(transport.named("feature_first_use")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ feature: "playhead_seek" }),
      }),
    ]);

    cleanup();
    const off = recordingAnalytics();
    off.consent.set({ productAnalytics: false });
    const offAudio = fakeAudio().audio;
    renderHeader(fakeSession().session, offAudio, () => {}, off.analytics);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bar" }), {
      target: { value: "2" },
    });
    expect(offAudio.seekTicks).toHaveBeenCalledWith(TICKS_PER_BAR);
    expect(off.transport.events).toEqual([]);
  });
});
