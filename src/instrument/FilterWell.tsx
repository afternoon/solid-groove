import { For, type JSX } from "@solidjs/web";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { ParameterDefinition } from "../domain/parameters";
import DragSurface from "./DragSurface";
import {
  BOTTOM_DB,
  type FilterShape,
  frequencyAt,
  positionOf,
  responsePath,
  TOP_DB,
} from "./filterResponse";
import Well from "./Well";

export interface FilterWellProps {
  readonly shape: FilterShape;
  readonly cutoff: ParameterDefinition;
  readonly resonance: ParameterDefinition;
  readonly values: { readonly cutoff: number; readonly resonance: number };
  /** The live value beside the title, e.g. "1.8 kHz · Q 5". */
  readonly readout: JSX.Element;
  command(definition: ParameterDefinition, value: number): RawCommandInput;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  onCommit?(): void;
}

const WIDTH = 300;
const HEIGHT = 100;
const DECADES = [100, 1000, 10_000];

/**
 * A filter's response drawn in a well, with one point to drag (#447): left
 * and right set the cutoff along the same log axis the curve is drawn on, up
 * and down the resonance. The faders beside it write the same two values.
 */
export default function FilterWell(props: FilterWellProps): JSX.Element {
  const curve = () =>
    responsePath(props.shape, props.values.cutoff, props.values.resonance, WIDTH, HEIGHT);
  const zeroDb = (TOP_DB / (TOP_DB - BOTTOM_DB)) * HEIGHT;
  const span = () => props.resonance.max - props.resonance.min;

  return (
    <Well
      title="Filter · drag the point"
      value={props.readout}
      scale={["20", "100", "1k", "10k", "20k"]}
      class="filter-well"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <For each={DECADES}>
          {(hz) => {
            const x = positionOf(hz) * WIDTH;
            return <line class="well-grid" x1={x} x2={x} y1="0" y2={HEIGHT} />;
          }}
        </For>
        <line class="well-grid" x1="0" x2={WIDTH} y1={zeroDb} y2={zeroDb} />
        <path class="well-area" d={`${curve()} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`} />
        <path class="well-line" d={curve()} />
      </svg>
      <DragSurface
        grab={() => "point" as const}
        commands={(point) => [
          props.command(
            props.cutoff,
            Math.min(props.cutoff.max, Math.max(props.cutoff.min, frequencyAt(point.x))),
          ),
          props.command(props.resonance, props.resonance.min + point.y * span()),
        ]}
        summary={() => "Shape filter"}
        dispatch={(commands) => props.dispatch(commands)}
        beginGesture={(options) => props.beginGesture(options)}
        onCommit={() => props.onCommit?.()}
      >
        <i
          class="drag-handle"
          style={{
            left: `${positionOf(props.values.cutoff) * 100}%`,
            top: `${(1 - (props.values.resonance - props.resonance.min) / span()) * 100}%`,
          }}
        />
      </DragSurface>
    </Well>
  );
}
