import type { TransactionResult } from "./execute";
import type { Gesture, GestureOptions } from "./history";
import type { RawCommandInput } from "./types";

/**
 * Drives one continuous control — a fader, a pan, an instrument slider —
 * through the command layer.
 *
 * A drag is one gesture: the first `input` opens it, every later `input`
 * applies live inside it, and the `change` the browser fires on release closes
 * it — so the whole drag is one history entry, one revision, one save, and at
 * most one analytics event, however many pointer moves it took. A keyboard
 * arrow fires `input` then `change`, so it is one gesture per press.
 *
 * Applying every step live is the behaviour, not an optimization: a control
 * painted from project state sits frozen under the pointer, and the audio
 * graph reading that state does not move either, if nothing applies until
 * release (#254). A caller whose `beginGesture` declines still lands each
 * value, through `dispatch`.
 */
export function createControlGesture(props: {
  beginGesture(options?: GestureOptions): Gesture | undefined;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** The history summary for the whole gesture, read when it opens. */
  summary(): string;
  /** The command that writes `value`, built fresh for every step. */
  command(value: number): RawCommandInput;
}) {
  let gesture: Gesture | undefined;

  return {
    input(value: number): void {
      if (!gesture?.active) {
        gesture = props.beginGesture({ summary: props.summary() });
      }
      const command = props.command(value);
      if (gesture?.active) {
        gesture.apply(command);
      } else {
        props.dispatch(command);
      }
    },
    commit(value: number): void {
      // The final `input` already applied this exact value inside the gesture;
      // closing it is all that is left. With no gesture open (a `change` with
      // no preceding `input`) the value still has to land.
      if (gesture?.active) {
        gesture.commit();
      } else {
        props.dispatch(props.command(value));
      }
      gesture = undefined;
    },
  };
}
