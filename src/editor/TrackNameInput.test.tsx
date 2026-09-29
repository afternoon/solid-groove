import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { CommandHistory } from "../commands";
import { createSliceFixtureProject } from "../domain/fixtures";
import { fireAndFlush } from "../testing/events";
import TrackNameInput from "./TrackNameInput";

afterEach(cleanup);

function renderInput() {
  const history = new CommandHistory(createSliceFixtureProject());
  const track = history.project.song.tracks[0];
  render(() => (
    <TrackNameInput
      track={history.project.song.tracks[0]}
      dispatch={(commands) => history.execute(commands)}
      class="name"
    />
  ));
  const input = screen.getByRole("textbox") as HTMLInputElement;
  return { history, track, input };
}

describe("TrackNameInput", () => {
  it("commits a changed name as one undoable command", () => {
    const { history, input } = renderInput();
    input.value = "  Kick drum ";
    fireAndFlush(() => fireEvent.change(input));
    expect(history.project.song.tracks[0].name).toBe("Kick drum");
    history.undo();
    expect(history.canUndo).toBe(false);
  });

  it("puts the track's name back when the new one is empty", () => {
    const { history, track, input } = renderInput();
    input.value = "   ";
    fireAndFlush(() => fireEvent.change(input));
    expect(input.value).toBe(track.name);
    expect(history.canUndo).toBe(false);
  });
});
