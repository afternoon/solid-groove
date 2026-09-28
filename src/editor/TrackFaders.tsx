import type { JSX } from "@solidjs/web";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import { createControlGesture, setParameter } from "../commands";
import type { Track } from "../domain/entities";
import { dbToFaderPosition, faderPositionToDb, formatDb } from "../domain/faders";
import { clampParameterValue, TRACK_VOLUME } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { parseParameterInput } from "../instrument/parseValue";

/**
 * The volume fader's own coordinate space: a normalized fader position, not the
 * decibels it writes. `src/domain/faders.ts` maps between the two so the travel
 * is perceptual rather than linear in dB.
 */
const FADER_RANGE = { min: 0, max: 1, step: 0.001 } as const;

export interface FaderProps {
  readonly track: Track;
  readonly value: number;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** The range input's id; each surface a track is shown on needs its own. */
  readonly inputId?: string;
  /** A mixer strip's fader stands; a track header's lies along it (#447). */
  readonly orientation?: "vertical" | "horizontal";
}

export function VolumeFader(props: FaderProps): JSX.Element {
  const position = () => dbToFaderPosition(TRACK_VOLUME, props.value);
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => `Set volume for ${props.track.name}`,
    command: (value) =>
      setParameter(
        {
          scope: "track",
          trackId: props.track.id,
          parameterId: TRACK_VOLUME.id,
        },
        faderPositionToDb(TRACK_VOLUME, value),
      ),
  });

  return (
    <FillSlider
      definition={TRACK_VOLUME}
      inputId={props.inputId ?? `mixer-volume-${props.track.id}`}
      orientation={props.orientation}
      label="Vol"
      ariaLabel={`Volume for ${props.track.name}`}
      range={FADER_RANGE}
      value={position()}
      displayValue={formatDb(TRACK_VOLUME, props.value)}
      // The field takes decibels; the fader travels in positions.
      parseEntry={(text) => {
        const db = parseParameterInput(TRACK_VOLUME, text, props.value);
        return db === null
          ? null
          : dbToFaderPosition(TRACK_VOLUME, clampParameterValue(TRACK_VOLUME, db));
      }}
      onInput={(value) => control.input(value)}
      onCommit={(value) => control.commit(value)}
    />
  );
}
