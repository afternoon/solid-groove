import type { JSX } from "@solidjs/web";
import "./Faceplate.css";

export interface ControlGroupProps {
  readonly title: string;
  readonly class?: string;
  readonly style?: JSX.CSSProperties;
  readonly children: JSX.Element;
}

/**
 * A row of related controls under one title and a rule that spans them — the
 * way a Juno labels its fader banks (#447). The controls share the row evenly,
 * so faders in a group sit on one pitch.
 */
export default function ControlGroup(props: ControlGroupProps): JSX.Element {
  return (
    <div class={["control-group", props.class]} style={props.style}>
      <div class="control-group-head">
        <h3 class="control-group-title">{props.title}</h3>
      </div>
      <div class="control-group-row">{props.children}</div>
    </div>
  );
}
