import type { SongLoop } from "../domain/entities";
import { TICKS_PER_BAR } from "../domain/time";

export interface LoopBraceControlsProps {
  readonly loop: SongLoop;
  /** Asks for a new range. The host commits it through the command layer. */
  readonly onSetRange: (startTicks: number, endTicks: number) => void;
  /** The element that reads the range out, so each control is described by it. */
  readonly describedBy: string;
}

/**
 * The keyboard path to the ruler's loop brace (`LOOP-018`; PRD section 8).
 *
 * The brace is a canvas drawing, so a pointer is the only thing that can grab
 * it there. These are its keyboard twins: one native spinbutton moves the
 * brace (its first bar) and one resizes it (its length in bars). Native number
 * inputs, so the arrow keys come from the browser rather than from a keydown
 * listener of this component's own (KEY-01), and every change is described by
 * the arrangement's accessible mirror of the range.
 */
export function LoopBraceControls(props: LoopBraceControlsProps) {
  const startBar = () => props.loop.startTicks / TICKS_PER_BAR + 1;
  const lengthBars = () => (props.loop.endTicks - props.loop.startTicks) / TICKS_PER_BAR;

  /** A whole number of at least 1, or null for anything else typed. */
  function wholeBars(input: HTMLInputElement): number | null {
    const value = Number(input.value);
    return Number.isInteger(value) && value >= 1 ? value : null;
  }

  function commit(input: HTMLInputElement, first: number | null, length: number | null) {
    if (first === null || length === null) {
      // Nothing to commit: show the brace as it still is.
      input.value = String(input.name === "loop-start" ? startBar() : lengthBars());
      return;
    }
    const startTicks = (first - 1) * TICKS_PER_BAR;
    props.onSetRange(startTicks, startTicks + length * TICKS_PER_BAR);
  }

  return (
    <fieldset class="arrangement-loop-controls" aria-label="Loop brace">
      <label class="arrangement-loop-field">
        <span>Loop start</span>
        <input
          type="number"
          name="loop-start"
          min={1}
          step={1}
          value={startBar()}
          aria-describedby={props.describedBy}
          onChange={(event) =>
            commit(event.currentTarget, wholeBars(event.currentTarget), lengthBars())
          }
        />
      </label>
      <label class="arrangement-loop-field">
        <span>Loop length</span>
        <input
          type="number"
          name="loop-length"
          min={1}
          step={1}
          value={lengthBars()}
          aria-describedby={props.describedBy}
          onChange={(event) =>
            commit(event.currentTarget, startBar(), wholeBars(event.currentTarget))
          }
        />
      </label>
    </fieldset>
  );
}
