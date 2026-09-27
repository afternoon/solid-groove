import type { JSX } from "@solidjs/web";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import { createControlGesture, setParameter } from "../commands";
import { deviceTypeDefinition } from "../domain/devices";
import type { Device } from "../domain/entities";
import { dbToFaderPosition, faderPositionToDb, formatDb } from "../domain/faders";
import { clampParameterValue, MASTER_VOLUME } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { parseParameterInput } from "../instrument/parseValue";

const FADER_RANGE = { min: 0, max: 1, step: 0.001 } as const;

/** A chain's devices by name, in signal order, for a strip's footer (#447). */
export function chainSummary(devices: readonly Device[]): string {
  if (devices.length === 0) return "No devices";
  return devices
    .map((device) => deviceTypeDefinition(device.type)?.label ?? device.type)
    .join(" · ");
}

export interface MasterStripProps {
  /** The master's volume, in dB. */
  readonly volume: number;
  readonly devices: readonly Device[];
  /** Takes the user to the master's effects, below the desk. */
  onSelect(): void;
  onFirstUse(): void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/**
 * The master as the last strip on the desk, pinned to its right edge (#447):
 * its name — the way to its effects — its volume on the same fader law as a
 * track's, and the chain it carries. `master.volume` was in the song but had
 * no control until now.
 */
export default function MasterStrip(props: MasterStripProps): JSX.Element {
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => "Set master volume",
    command: (position) =>
      setParameter(
        { scope: "master", parameterId: MASTER_VOLUME.id },
        faderPositionToDb(MASTER_VOLUME, position),
      ),
  });

  return (
    <div class="mixer-strip mixer-master-strip">
      <div class="mixer-strip-head">
        <button
          type="button"
          class="mixer-master-select"
          onClick={() => props.onSelect()}
        >
          Master
        </button>
      </div>
      <div class="mixer-strip-controls">
        <FillSlider
          definition={MASTER_VOLUME}
          inputId="mixer-volume-master"
          label="Vol"
          ariaLabel="Master volume"
          range={FADER_RANGE}
          value={dbToFaderPosition(MASTER_VOLUME, props.volume)}
          displayValue={formatDb(MASTER_VOLUME, props.volume)}
          parseEntry={(text) => {
            const db = parseParameterInput(MASTER_VOLUME, text, props.volume);
            return db === null
              ? null
              : dbToFaderPosition(MASTER_VOLUME, clampParameterValue(MASTER_VOLUME, db));
          }}
          onInput={(position) => {
            props.onFirstUse();
            control.input(position);
          }}
          onCommit={(position) => control.commit(position)}
        />
      </div>
      <div class="mixer-strip-actions">
        <span class="mixer-strip-chain" title={chainSummary(props.devices)}>
          {chainSummary(props.devices)}
        </span>
      </div>
    </div>
  );
}
