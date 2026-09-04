import { type JSX, Show } from "@solidjs/web";
import { createMemo } from "solid-js";
import { clampParameterValue, type ParameterDefinition } from "../domain/parameters";
import "./FillSlider.css";

/**
 * The coordinate space a slider moves in, when that differs from the
 * parameter's own range — a volume fader travels in perceptual `0..1` fader
 * positions while the parameter it writes is decibels.
 */
export interface FillSliderRange {
  readonly min: number;
  readonly max: number;
  readonly step?: number | null;
}

export interface FillSliderProps {
  readonly definition: ParameterDefinition;
  readonly value: number;
  /** Formatted live value shown under the slider (e.g. "760 Hz"). */
  readonly displayValue: string;
  /** Called with a coerced, in-range value while dragging. */
  onInput(value: number): void;
  /** Called once when the drag/keyboard gesture commits. */
  onCommit(value: number): void;
  /**
   * A unique element id for the input. Required when more than one slider for
   * the same parameter is on screen — a mixer has one volume fader per track.
   */
  readonly inputId?: string;
  /** Visible label above the slider. Defaults to the parameter's own label. */
  readonly label?: string;
  /**
   * Accessible name for the input, when the visible label alone is ambiguous
   * (a mixer's "VOL" needs to say which track it belongs to).
   */
  readonly ariaLabel?: string;
  /** The slider's own coordinate space, if not the parameter's range. */
  readonly range?: FillSliderRange;
  /**
   * Which way the fill travels. Vertical is the default and the mock's shape;
   * horizontal is for a value whose range *is* an axis the user already reads
   * left-to-right — pan being the one that matters, where a vertical control
   * would ask them to translate "up" into "right".
   */
  readonly orientation?: "vertical" | "horizontal";
  /**
   * Fill outwards from the centre rather than from the start of the track, for
   * a bipolar value where the centre is the meaningful rest position. A pan
   * filled from the left would read "half loud" at centre.
   */
  readonly bipolar?: boolean;
  /**
   * Drop the label row and the value readout, leaving the fill track alone,
   * for a control with nowhere to put them — a piano-roll note block is a few
   * pixels tall. `ariaLabel` then carries the name the visible label would
   * have, so the control is still announced and still keyboard-operable.
   */
  readonly compact?: boolean;
}

/**
 * The one continuous control (design mock `06c-slider`): a thumbless fill track
 * with its label and live value beside it. The filled portion *is* the value;
 * dragging along the track maps directly onto the fill. Vertical by default;
 * `orientation="horizontal"` lays the same control on its side for a value the
 * user reads as a left-right axis, and `bipolar` fills it out from the centre.
 *
 * It is a real `<input type="range">` underneath — so it is keyboard-operable
 * and screen-reader labelled for free — visually restyled to a fill track. The
 * range's own `step` follows the parameter definition, so a stepped parameter
 * (pitch in semitones, waveform index) snaps and a continuous one (cutoff) does
 * not.
 *
 * `onInput` fires per movement so the audio graph can follow live; `onCommit`
 * fires once when the gesture ends, which is where the caller opens/closes a
 * single history gesture so a drag is one undo step and emits nothing per tick.
 */
export default function FillSlider(props: FillSliderProps): JSX.Element {
  const id = () => props.inputId ?? defaultInputId(props.definition.id);
  const scale = (): FillSliderRange => props.range ?? props.definition;

  const fillPercent = createMemo(() => {
    const { min, max } = scale();
    const span = max - min;
    if (span <= 0) return 0;
    return ((props.value - min) / span) * 100;
  });

  const horizontal = () => props.orientation === "horizontal";

  /**
   * Where the accent is painted. A unipolar slider fills from the start of the
   * track to the value; a bipolar one fills from the centre out to it, in
   * whichever direction the value went. The centre span never collapses to
   * nothing, so a value sitting exactly at rest still shows where it is.
   */
  const fillStyle = createMemo((): JSX.CSSProperties => {
    const percent = fillPercent();
    if (!horizontal()) return { height: `${percent}%` };
    if (!props.bipolar) return { left: "0%", width: `${percent}%` };
    const from = Math.min(percent, 50);
    const to = Math.max(percent, 50);
    return { left: `${from}%`, width: `${to - from}%` };
  });

  const coerce = (raw: number): number => {
    const range = props.range;
    if (!range) return clampParameterValue(props.definition, raw);
    if (!Number.isFinite(raw)) return range.min;
    return Math.min(range.max, Math.max(range.min, raw));
  };

  return (
    <div
      class={[
        "fill-slider",
        {
          horizontal: horizontal(),
          bipolar: props.bipolar === true,
          compact: props.compact === true,
        },
      ]}
    >
      <Show when={props.compact !== true}>
        <label class="fill-slider-label" for={id()}>
          {props.label ?? props.definition.label}
        </label>
      </Show>
      <div class="fill-slider-track">
        <div class="fill-slider-fill" style={fillStyle()} aria-hidden="true" />
        <input
          id={id()}
          class="fill-slider-input"
          type="range"
          // The orientation the pointer and arrow keys actually move in.
          aria-orientation={horizontal() ? "horizontal" : "vertical"}
          aria-label={props.ariaLabel}
          // The slider's raw number is meaningless to a screen reader — a
          // fader position, or a bipolar pan. Announce what is painted.
          aria-valuetext={props.displayValue}
          min={scale().min}
          max={scale().max}
          step={scale().step ?? "any"}
          value={props.value}
          onInput={(event) => props.onInput(coerce(event.currentTarget.valueAsNumber))}
          // `change` settles a drag or a keyboard nudge, but it does not fire
          // at all when a drag ends somewhere the input never hears about —
          // released off-element, or the panel unmounted mid-drag by a track
          // switch. That left the gesture open forever, and the next control
          // touched anywhere in the editor threw "a gesture is already in
          // progress" out of its own `input` handler and locked up. Pointer
          // up/cancel close the same gesture; extra commits are a safe no-op.
          // (`PianoRollNote` already covers its velocity slider this way.)
          onChange={(event) => props.onCommit(coerce(event.currentTarget.valueAsNumber))}
          onPointerUp={(event) =>
            props.onCommit(coerce(event.currentTarget.valueAsNumber))
          }
          onPointerCancel={(event) =>
            props.onCommit(coerce(event.currentTarget.valueAsNumber))
          }
        />
      </div>
      <Show when={props.compact !== true}>
        <output class="fill-slider-value" for={id()}>
          {props.displayValue}
        </output>
      </Show>
    </div>
  );
}

function defaultInputId(parameterId: string): string {
  return `fill-slider-${parameterId.replace(/\./g, "-")}`;
}
