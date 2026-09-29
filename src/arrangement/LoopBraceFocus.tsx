import type { SongLoop } from "../domain/entities";
import { TICKS_PER_BAR } from "../domain/time";
import { describeLoopBars } from "./loopBrace";

/** Bars have no ceiling in the domain, but an ARIA slider has to say something. */
const LAST_BAR = 9999;

export interface LoopBraceFocusProps {
  readonly loop: SongLoop;
  /** The brace's left edge and width in CSS pixels, local to the timeline. */
  readonly leftPx: number;
  readonly widthPx: number;
  /** Where the timeline starts, past the header column. */
  readonly insetPx: number;
  /** The element that reads the range out, so the brace is described by it. */
  readonly describedBy: string;
  readonly onFocusChange: (focused: boolean) => void;
}

/**
 * The keyboard path to the ruler's loop brace (`LOOP-018`; PRD section 8).
 *
 * The brace is a canvas drawing, so only a pointer can grab it. This is its DOM
 * twin: a focusable slider laid over the drawing, valued by the brace's first
 * bar and worded by `describeLoopBars`. It listens to no keys itself — they
 * arrive through the registry's `loop_brace` context, which the host turns on
 * while this has focus (KEY-01) — and it is transparent to the pointer.
 */
export function LoopBraceFocus(props: LoopBraceFocusProps) {
  return (
    <div class="arrangement-loop-lane" style={{ left: `${props.insetPx}px` }}>
      {/* biome-ignore lint/a11y/useFocusableInteractive: it is focusable; Solid's JSX types spell the attribute `tabindex`, which the rule does not read */}
      <div
        class="arrangement-loop-brace"
        data-testid="arrangement-loop-brace"
        role="slider"
        tabindex={0}
        aria-label="Loop brace"
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={LAST_BAR}
        aria-valuenow={props.loop.startTicks / TICKS_PER_BAR + 1}
        aria-valuetext={describeLoopBars(props.loop)}
        aria-describedby={props.describedBy}
        style={{ left: `${props.leftPx}px`, width: `${props.widthPx}px` }}
        onFocus={() => props.onFocusChange(true)}
        onBlur={() => props.onFocusChange(false)}
      />
    </div>
  );
}
