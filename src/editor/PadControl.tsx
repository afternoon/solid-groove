import type { JSX } from "@solidjs/web";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import { createControlGesture, setPadParameter } from "../commands";
import type { DrumPad, Track } from "../domain/entities";
import type { ParameterDefinition } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";

export interface PadControlProps {
  readonly trackId: Track["id"];
  readonly pad: DrumPad;
  readonly definition: ParameterDefinition;
  readonly label: string;
  readonly value: number;
  readonly displayValue: string;
  readonly bipolar?: boolean;
  /** On its side in the pad table's row; standing in the pad editor. */
  readonly orientation?: "horizontal" | "vertical";
  /** The accessible name; by default it says whose pad, as a row must. */
  readonly ariaLabel?: string;
  /** Where the control is, so each copy's input id is its own. */
  readonly idPrefix?: string;
  onFirstUse(): void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * One continuous pad control (#255): the same thumbless fill slider as every
 * other continuous control in the editor, on its side to fit the pad lane, and
 * driven as one gesture per drag. Each pointer sample applies live inside the
 * open gesture — so the value follows the pointer on screen and in the audio
 * graph — and release commits the whole drag as one history entry, one revision
 * and one save. Dispatching a command straight from `input`, as this did, made
 * one drag dozens of revisions and dozens of undo steps.
 */
export default function PadControl(props: PadControlProps): JSX.Element {
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => `Set ${props.definition.label} on a pad`,
    command: (value) =>
      setPadParameter(
        props.trackId,
        props.pad.id,
        props.definition.id as Parameters<typeof setPadParameter>[2],
        value,
      ),
  });

  return (
    <FillSlider
      definition={props.definition}
      inputId={`${props.idPrefix ?? "pad"}-${props.pad.id}-${props.label.toLowerCase()}`}
      label={props.label}
      // Every pad row shows a "Pitch", so the name has to say whose.
      ariaLabel={props.ariaLabel ?? `${props.label} for ${props.pad.name}`}
      orientation={props.orientation ?? "horizontal"}
      bipolar={props.bipolar}
      value={props.value}
      displayValue={props.displayValue}
      onInput={(value) => {
        props.onFirstUse();
        control.input(value);
      }}
      onCommit={(value) => control.commit(value)}
    />
  );
}
