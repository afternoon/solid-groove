import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import type { ControlAddress } from "../commands/controlAddress";
import { control as controlRef } from "../controls/control";
import { clampParameterValue, type ParameterDefinition } from "../domain/parameters";
import "./FillSlider.css";
import { parseParameterInput } from "./parseValue";

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
  /**
   * Formatted live value (e.g. "760 Hz"). It is shown in the slider's value
   * field, which also takes a typed value (#447).
   */
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
   * Reads a typed value into the slider's own coordinate space, or null when
   * it is not a value. Only needed when `range` is a different space from the
   * parameter (a volume fader's positions); otherwise the text is read in the
   * parameter's own unit.
   */
  readonly parseEntry?: (text: string) => number | null;
  /**
   * Where a double-click puts the slider back, in the slider's own coordinate
   * space. It defaults to the parameter's declared default, which is only right
   * when the slider moves in the parameter's own space, so a slider with a
   * different `range` (a volume fader's positions) must supply it.
   */
  readonly resetValue?: number;
  /**
   * Shown but not adjustable: the value is set by another control (a synced
   * delay's Time follows its division), so neither the track nor the value
   * field takes input.
   */
  readonly disabled?: boolean;
  /**
   * The value this slider shows, as a control address (`UI-004`), so a reveal
   * can find it and a proposal can outline it. Omitted for a slider that does
   * not stand for one domain value.
   */
  readonly control?: ControlAddress;
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
 * Double-clicking the slider reverts it to the parameter's default.
 *
 * `onInput` fires per movement so the audio graph can follow live; `onCommit`
 * fires once when the gesture ends, which is where the caller opens/closes a
 * single history gesture so a drag is one undo step and emits nothing per tick.
 */
export default function FillSlider(props: FillSliderProps): JSX.Element {
  const id = () => props.inputId ?? defaultInputId(props.definition.id);
  /** The slider's accessible name; its value field is "<name> value". */
  const name = () => props.ariaLabel ?? props.label ?? props.definition.label;
  const scale = (): FillSliderRange => props.range ?? props.definition;

  const fillPercent = createMemo(() => {
    const { min, max } = scale();
    const span = max - min;
    if (span <= 0) return 0;
    return ((props.value - min) / span) * 100;
  });

  const horizontal = () => props.orientation === "horizontal";

  /** Where the cap sits: the value's end of the fill, as a percentage. */
  const capStyle = createMemo((): JSX.CSSProperties => {
    const at = `calc((100% - var(--fill-slider-cap-size)) * ${fillPercent() / 100})`;
    return horizontal() ? { left: at } : { bottom: at };
  });

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

  let entry: HTMLInputElement | undefined;

  /** Puts the field back to the live value, discarding what was typed. */
  const revert = () => {
    if (entry) entry.value = props.displayValue;
  };

  /**
   * Lands a typed value as one edit: the same `input` then `commit` a drag
   * ends with, so it is one history entry. Anything unreadable is refused and
   * the field shows the live value again.
   */
  const commitEntry = () => {
    if (!entry) return;
    const typed = entry.value;
    if (typed.trim() === props.displayValue) return;
    const parsed = props.parseEntry
      ? props.parseEntry(typed)
      : parseParameterInput(props.definition, typed);
    if (parsed === null) {
      entry.setAttribute("aria-invalid", "true");
      revert();
      return;
    }
    entry.removeAttribute("aria-invalid");
    const value = coerce(parsed);
    props.onInput(value);
    props.onCommit(value);
    revert();
  };

  /**
   * Double-clicking the slider puts it back to its default, as the same `input`
   * then `commit` a typed value lands with, so it is one history entry. The
   * value field is left alone: a double-click there selects text.
   */
  const reset = () => {
    const target =
      props.resetValue ?? (props.range ? undefined : props.definition.defaultValue);
    if (target === undefined) return;
    const value = coerce(target);
    props.onInput(value);
    props.onCommit(value);
  };

  const coerce = (raw: number): number => {
    const range = props.range;
    if (!range) return clampParameterValue(props.definition, raw);
    if (!Number.isFinite(raw)) return range.min;
    return Math.min(range.max, Math.max(range.min, raw));
  };

  return (
    <div
      ref={controlRef(() => props.control)}
      class={[
        "fill-slider",
        {
          horizontal: horizontal(),
          bipolar: props.bipolar === true,
          disabled: props.disabled === true,
        },
      ]}
    >
      <input
        ref={entry}
        class="fill-slider-entry"
        type="text"
        inputmode="decimal"
        spellcheck={false}
        autocomplete="off"
        aria-label={`${name()} value`}
        value={props.displayValue}
        disabled={props.disabled}
        onFocus={(event) => event.currentTarget.select()}
        // Enter fires `change` in a text field, as leaving it does, so both
        // commit. Keys are otherwise left alone: key handling lives in
        // src/shortcuts, and the slider beside this field owns the arrows.
        onChange={(event) => {
          commitEntry();
          if (document.activeElement === event.currentTarget)
            event.currentTarget.select();
        }}
      />
      <div class="fill-slider-track">
        <div class="fill-slider-fill" style={fillStyle()} aria-hidden="true" />
        <div class="fill-slider-cap" style={capStyle()} aria-hidden="true" />
        <input
          id={id()}
          class="fill-slider-input"
          type="range"
          // The orientation the pointer and arrow keys actually move in.
          aria-orientation={horizontal() ? "horizontal" : "vertical"}
          // Named on the element itself, not only through the `<label for>`
          // below (#866): an audit that reads the name off the slider found
          // it unnamed, and the label's uppercase styling leaks into the
          // computed name. The value field beside it says "<name> value".
          aria-label={name()}
          // The slider's raw number is meaningless to a screen reader — a
          // fader position, or a bipolar pan. Announce what is painted.
          aria-valuetext={props.displayValue}
          min={scale().min}
          max={scale().max}
          step={scale().step ?? "any"}
          value={props.value}
          disabled={props.disabled}
          onInput={(event) => props.onInput(coerce(event.currentTarget.valueAsNumber))}
          // `change` settles a drag or a keyboard nudge, but it does not fire
          // at all when a drag ends somewhere the input never hears about —
          // released off-element, or the panel unmounted mid-drag by a track
          // switch. That left the gesture open forever, and the next control
          // touched anywhere in the editor threw "a gesture is already in
          // progress" out of its own `input` handler and locked up. Pointer
          // up/cancel close the same gesture; extra commits are a safe no-op.
          onChange={(event) => props.onCommit(coerce(event.currentTarget.valueAsNumber))}
          onDblClick={reset}
          onPointerUp={(event) =>
            props.onCommit(coerce(event.currentTarget.valueAsNumber))
          }
          onPointerCancel={(event) =>
            props.onCommit(coerce(event.currentTarget.valueAsNumber))
          }
        />
      </div>
      <label class="fill-slider-label" for={id()}>
        {props.label ?? props.definition.label}
      </label>
    </div>
  );
}

function defaultInputId(parameterId: string): string {
  return `fill-slider-${parameterId.replace(/\./g, "-")}`;
}
