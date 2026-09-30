import { For, type JSX, Show } from "@solidjs/web";
import "./grid.css";

export interface RulerProps {
  /** How many 1/16 steps the clip holds. */
  readonly steps: number;
  /** A step's width in pixels at the current zoom. */
  readonly stepWidth: number;
  /**
   * The insert marker's step: where a paste lands. A ruler with no marker
   * (the step grid's, #643) only labels the steps.
   */
  readonly marker?: number;
  onSetMarker?(step: number): void;
}

/** A bar's first step reads its bar number; a beat's reads "bar.beat". */
function stepLabel(step: number, stepWidth: number): string {
  if (step % 16 === 0) return `${step / 16 + 1}`;
  // Beat labels only where four steps leave room to read them.
  if (step % 4 === 0 && stepWidth * 4 >= 36) {
    return `${Math.floor(step / 16) + 1}.${(step % 16) / 4 + 1}`;
  }
  return "";
}

/**
 * The ruler over the grid: one button per step, "Step 1" onward, each as wide
 * as its column so a step is found where its button is. Clicking one sets the
 * insert marker, which is where a paste lands (as in Ableton).
 */
export default function Ruler(props: RulerProps): JSX.Element {
  const indices = () => Array.from({ length: props.steps }, (_, index) => index);
  return (
    <fieldset
      class="pr-ruler"
      aria-label="Ruler"
      aria-hidden={props.onSetMarker ? undefined : "true"}
      style={{ width: `${props.steps * props.stepWidth}px` }}
    >
      <For each={indices()}>
        {(step) => (
          <button
            type="button"
            class={["pr-ruler-step", { bar: step % 16 === 0, beat: step % 4 === 0 }]}
            style={{ left: `${step * props.stepWidth}px`, width: `${props.stepWidth}px` }}
            aria-label={`Step ${step + 1}`}
            aria-current={props.marker === step ? "true" : undefined}
            disabled={!props.onSetMarker}
            onClick={() => props.onSetMarker?.(step)}
          >
            {stepLabel(step, props.stepWidth)}
          </button>
        )}
      </For>
      <Show when={props.marker !== undefined}>
        <span
          class="pr-ruler-marker"
          style={{ left: `${(props.marker ?? 0) * props.stepWidth}px` }}
          aria-hidden="true"
        />
      </Show>
    </fieldset>
  );
}
