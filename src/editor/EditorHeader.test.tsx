import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, createStore, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSliceFixtureProject } from "../domain/fixtures";
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

function renderHeader(
  session: HeaderSession,
  audio: HeaderAudio,
  onToggleLoop: () => void = () => {},
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

    expect(screen.getByText("1.1")).toBeInTheDocument();
    setPositionTicks(192 * 5);
    flush();
    expect(screen.getByText("2.2")).toBeInTheDocument();
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

  it("shows the song's time signature from the session's project", () => {
    renderHeader(fakeSession().session, fakeAudio().audio);
    expect(screen.getByTitle("Time signature (fixed at 4/4)")).toHaveTextContent(
      "Time signature 4/4",
    );
  });
});
