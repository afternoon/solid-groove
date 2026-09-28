import { For, type JSX, Show } from "@solidjs/web";
import "./Faceplate.css";

export interface WellProps {
  /** What the well shows, e.g. "Amp envelope". */
  readonly title: string;
  /** The live value it is drawing, beside the title. */
  readonly value?: JSX.Element;
  /** Labels hung beneath the drawing, spread from its left edge to its right. */
  readonly scale?: readonly string[];
  readonly class?: string;
  readonly children: JSX.Element;
}

/**
 * The black frame that holds what a control does to the sound — a filter's
 * response, an envelope, a waveform (#447). It draws nothing itself: its
 * children are the drawing and whatever can be dragged on it.
 */
export default function Well(props: WellProps): JSX.Element {
  return (
    <div class={["well", props.class]}>
      <div class="well-head">
        <span class="well-title">{props.title}</span>
        <Show when={props.value}>
          <span class="well-value">{props.value}</span>
        </Show>
      </div>
      <div class="well-screen">
        {props.children}
        <Show when={props.scale}>
          {(scale) => (
            <div class="well-scale" aria-hidden="true">
              <For each={scale()}>{(label) => <span>{label}</span>}</For>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
