import { describe, expect, it } from "vitest";
import { createSliceFixtureProject } from "../domain/fixtures";
import {
  bareParameterId,
  readInstrumentParameter,
  SAMPLER_PITCH,
} from "../domain/parameters";
import { createControlGesture } from "./controlGesture";
import { setParameter } from "./definitions/parameters";
import { CommandHistory } from "./history";

/**
 * One drag is one gesture — covered by the panel tests. What is covered here is
 * the case the panels cannot stage: what a control does when the *rest of the
 * editor* has left a gesture open. `CommandHistory.beginGesture` throws in that
 * situation, and a control has no way to know before it asks.
 */
describe("createControlGesture", () => {
  function setup() {
    const history = new CommandHistory(createSliceFixtureProject());
    const trackId = history.project.song.tracks[0].id;
    const pitch = () =>
      readInstrumentParameter(
        SAMPLER_PITCH,
        // biome-ignore lint/suspicious/noExplicitAny: fixture track is a sampler
        (history.project.song.tracks[0].instrument as any).parameters,
      );
    const make = () =>
      createControlGesture({
        beginGesture: (options) => history.beginGesture(options),
        dispatch: (commands) => history.execute(commands),
        summary: () => "Set pitch",
        command: (value) =>
          setParameter(
            {
              scope: "instrument",
              trackId,
              // The panels address instrument parameters by their bare id.
              parameterId: bareParameterId(SAMPLER_PITCH.id),
            },
            value,
          ),
      });
    return { history, make, pitch };
  }

  it("still lands values while another gesture is open, instead of throwing", () => {
    const { history, make, pitch } = setup();

    // A drag that never got its `change` — released off-element, or the panel
    // unmounted mid-drag — leaves this gesture open.
    make().input(3);
    expect(history.gestureActive).toBe(true);

    // The next control the user touches must keep working. Before this, the
    // `beginGesture` throw escaped through the control's own `input` handler
    // and the slider locked up: no movement, no value, no message.
    const next = make();
    expect(() => next.input(7)).not.toThrow();
    expect(pitch()).toBe(7);

    next.commit(7);
    expect(pitch()).toBe(7);
  });
});
