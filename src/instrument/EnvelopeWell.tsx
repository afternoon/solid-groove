import { For, type JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { ParameterDefinition } from "../domain/parameters";
import DragSurface from "./DragSurface";
import {
  type EnvelopeTimes,
  envelopePoints,
  nearestHandle,
  STAGE_SHARE,
  stageSeconds,
  stageWidth,
  sustainAt,
  svgPath,
} from "./envelopeGeometry";
import Well from "./Well";

export interface EnvelopeDefinitions {
  readonly attack: ParameterDefinition;
  readonly decay: ParameterDefinition;
  readonly sustain: ParameterDefinition;
  readonly release: ParameterDefinition;
}

export interface EnvelopeWellProps {
  readonly definitions: EnvelopeDefinitions;
  readonly times: EnvelopeTimes;
  /** The command that writes `value` to one of the four parameters. */
  command(definition: ParameterDefinition, value: number): RawCommandInput;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  onCommit?(): void;
}

const WIDTH = 300;
const HEIGHT = 100;

/**
 * An amp envelope drawn in a well, with its three corners draggable (#447):
 * the peak sets attack, the next corner decay and sustain, the last release
 * and sustain. The ADSR faders beside it write the same four parameters.
 */
export default function EnvelopeWell(props: EnvelopeWellProps): JSX.Element {
  // The longest time a stage can take; the three share one range.
  const max = () => props.definitions.attack.max;
  const points = createMemo(() => envelopePoints(props.times, max()));
  const outline = () => svgPath(points(), WIDTH, HEIGHT);

  const time = (definition: ParameterDefinition, width: number) =>
    Math.max(definition.min, stageSeconds(width, definition.max));

  return (
    <Well
      title="Amp envelope"
      value="ADSR"
      scale={["0", "Attack", "Decay", "Sustain", "Release"]}
      class="envelope-well"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <For each={[0.25, 0.5, 0.75]}>
          {(at) => (
            <line class="well-grid" x1={at * WIDTH} x2={at * WIDTH} y1="0" y2={HEIGHT} />
          )}
        </For>
        <path class="well-area" d={`${outline()} Z`} />
        <path class="well-line" d={outline()} />
      </svg>
      <DragSurface
        grab={(point) => nearestHandle(points(), point.x, point.y)}
        commands={(point, handle) => {
          const { attack, decay, sustain, release } = props.definitions;
          if (handle === 0) return [props.command(attack, time(attack, point.x))];
          const level = props.command(sustain, sustainAt(point.y));
          if (handle === 1) {
            const start = stageWidth(props.times.attack, max());
            return [props.command(decay, time(decay, point.x - start)), level];
          }
          return [
            props.command(release, time(release, Math.min(1 - point.x, STAGE_SHARE))),
            level,
          ];
        }}
        summary={() => "Shape amp envelope"}
        dispatch={(commands) => props.dispatch(commands)}
        beginGesture={(options) => props.beginGesture(options)}
        onCommit={() => props.onCommit?.()}
      >
        <For each={[1, 2, 3]}>
          {(index) => (
            <i
              class="drag-handle"
              style={{
                left: `${points()[index][0] * 100}%`,
                top: `${(1 - points()[index][1]) * 100}%`,
              }}
            />
          )}
        </For>
      </DragSurface>
    </Well>
  );
}
