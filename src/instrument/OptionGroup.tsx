import { For, type JSX } from "@solidjs/web";
import "./OptionGroup.css";

export interface OptionGroupOption<V extends string | number> {
  readonly value: V;
  readonly label: string;
  /** A small decorative glyph (e.g. a waveform icon) shown before the label. */
  readonly icon?: JSX.Element;
}

export interface OptionGroupProps<V extends string | number> {
  /** Accessible group name, e.g. "Waveform". */
  readonly legend: string;
  readonly options: readonly OptionGroupOption<V>[];
  /** The selected value, or null when the group has no selection yet. */
  readonly value: V | null;
  onSelect(value: V): void;
  /**
   * The radios' shared `name`. Defaults to one derived from the legend, which
   * is only unique while one group per legend is on the page — two delays on a
   * chain both have a "Sync", and one shared name would make them one group.
   */
  readonly radioGroup?: string;
  /**
   * Stretch the options to fill the height they are given, so the group stands
   * as a switch as tall as the faders beside it (#447).
   */
  readonly fill?: boolean;
  /** Shown but not choosable, as a whole group (#447). */
  readonly disabled?: boolean;
}

/**
 * A labelled option group (design mocks `05a`/`05b`): a vertical list of
 * mutually exclusive choices, the active one carrying the cyan accent. Built as
 * a radio group so exactly one is selected and arrow keys move between options.
 */
export default function OptionGroup<V extends string | number>(
  props: OptionGroupProps<V>,
): JSX.Element {
  return (
    <fieldset
      class={["option-group", { fill: props.fill === true }]}
      aria-label={props.legend}
      disabled={props.disabled}
    >
      <For each={props.options}>
        {(option) => {
          const selected = () => option.value === props.value;
          return (
            <label class={["option-group-option", { active: selected() }]}>
              <input
                type="radio"
                class="option-group-input"
                name={props.radioGroup ?? `option-group-${props.legend}`}
                checked={selected()}
                onChange={() => props.onSelect(option.value)}
              />
              {option.icon ? (
                <span class="option-group-icon" aria-hidden="true">
                  {option.icon}
                </span>
              ) : null}
              <span class="option-group-text">{option.label}</span>
            </label>
          );
        }}
      </For>
    </fieldset>
  );
}
