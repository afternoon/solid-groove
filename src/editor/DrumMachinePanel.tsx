import { For, type JSX, Show } from "@solidjs/web";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import {
  createControlGesture,
  setPadAsset,
  setPadChoke,
  setPadFlag,
  setPadParameter,
} from "../commands";
import type { Asset, DrumPad, Track } from "../domain/entities";
import { formatDb, formatPan } from "../domain/faders";
import type { AssetId, PadId } from "../domain/ids";
import {
  PAD_PITCH,
  type ParameterDefinition,
  TRACK_PAN,
  TRACK_VOLUME,
} from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { formatInstrumentValue } from "../instrument/formatValue";
import "./DrumMachinePanel.css";
import { ariaBool } from "../shared/aria";

/** The choke-group options a pad can join (PRD INS-01). `none` clears it. */
const CHOKE_GROUPS = Array.from({ length: 8 }, (_, i) => i);

export interface DrumMachinePanelProps {
  readonly track: Track;
  /** The project's sample assets, offered as pad sources. */
  readonly assets: readonly Asset[];
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Opens a pad-control drag that commits as one history entry (#255). */
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** Plays one pad immediately so the user hears their choice (audition). */
  audition?(padId: PadId): void;
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

function pads(track: Track): readonly DrumPad[] {
  return track.instrument?.kind === "drumMachine" ? track.instrument.pads : [];
}

/**
 * The drum-machine instrument panel (PRD INS-01, LOOP-005): one named lane per
 * pad, each with sample selection, audition, pitch, level, pan, amp envelope,
 * mute/solo, and choke group. Every edit is a shared drum command dispatched
 * through the same command layer a keyboard shortcut or the assistant would use
 * — the panel never mutates project state directly (PRD section 9.6).
 */
export default function DrumMachinePanel(props: DrumMachinePanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;

  /** Marks the drum machine as reached, once per account per browser. */
  function markFeatureUse(): void {
    analytics().logFeatureFirstUse("drum_machine");
  }

  function changePadAsset(pad: DrumPad, assetId: AssetId | null): void {
    markFeatureUse();
    props.dispatch(setPadAsset(props.track.id, pad.id, assetId));
    // A pad sample replacement is an instrument change (PRD OPS-02).
    analytics().log("instrument_changed", { instrument_type: "drum_machine" });
  }

  function toggleFlag(pad: DrumPad, flag: "muted" | "soloed"): void {
    markFeatureUse();
    props.dispatch(setPadFlag(props.track.id, pad.id, flag, !pad.mixer[flag]));
  }

  function changeChoke(pad: DrumPad, value: number | null): void {
    markFeatureUse();
    props.dispatch(setPadChoke(props.track.id, pad.id, value));
  }

  function audition(pad: DrumPad): void {
    markFeatureUse();
    props.audition?.(pad.id);
  }

  function padParam(pad: DrumPad, key: string, fallback: number): number {
    const value = pad.parameters[key];
    return value === undefined ? fallback : value;
  }

  return (
    <section class="drum-machine" aria-label={`Drum machine: ${props.track.name}`}>
      {/* Keyed on the pad's own id, so an edit to a pad updates its lane in
			    place. Keyed on the pad *object* — the default — every parameter edit
			    rebuilds that lane, and a drag applying live would lose the very input
			    it is moving on its first sample. */}
      <For each={pads(props.track)} keyed={(pad) => pad.id}>
        {(pad) => (
          <div class={["drum-pad", { muted: pad().mixer.muted }]}>
            <button
              type="button"
              class="pad-audition"
              onClick={() => audition(pad())}
              aria-label={`Audition ${pad().name}`}
              title={`Audition ${pad().name}`}
            >
              <span class="pad-name">{pad().name}</span>
            </button>

            <label class="pad-control pad-sample">
              <span class="pad-control-label">Sample</span>
              <select
                value={pad().assetId ?? ""}
                onChange={(event) =>
                  changePadAsset(
                    pad(),
                    event.currentTarget.value === ""
                      ? null
                      : (event.currentTarget.value as AssetId),
                  )
                }
              >
                <option value="">— none —</option>
                <For each={props.assets}>
                  {(asset) => <option value={asset.id}>{asset.name}</option>}
                </For>
              </select>
            </label>

            <PadControl
              trackId={props.track.id}
              pad={pad()}
              definition={PAD_PITCH}
              label="Pitch"
              value={padParam(pad(), "pitch", PAD_PITCH.defaultValue)}
              displayValue={formatInstrumentValue(
                PAD_PITCH,
                padParam(pad(), "pitch", PAD_PITCH.defaultValue),
              )}
              onFirstUse={markFeatureUse}
              dispatch={(commands) => props.dispatch(commands)}
              beginGesture={(options) => props.beginGesture(options)}
            />

            <PadControl
              trackId={props.track.id}
              pad={pad()}
              definition={TRACK_VOLUME}
              label="Level"
              value={pad().mixer.volume}
              displayValue={formatDb(TRACK_VOLUME, pad().mixer.volume)}
              onFirstUse={markFeatureUse}
              dispatch={(commands) => props.dispatch(commands)}
              beginGesture={(options) => props.beginGesture(options)}
            />

            <PadControl
              trackId={props.track.id}
              pad={pad()}
              definition={TRACK_PAN}
              label="Pan"
              // Pan's range *is* the stereo field, so it fills from centre.
              bipolar
              value={pad().mixer.pan}
              displayValue={formatPan(pad().mixer.pan)}
              onFirstUse={markFeatureUse}
              dispatch={(commands) => props.dispatch(commands)}
              beginGesture={(options) => props.beginGesture(options)}
            />

            <label class="pad-control pad-choke">
              <span class="pad-control-label">Choke</span>
              <select
                value={pad().chokeGroup === null ? "" : String(pad().chokeGroup)}
                onChange={(event) =>
                  changeChoke(
                    pad(),
                    event.currentTarget.value === ""
                      ? null
                      : Number(event.currentTarget.value),
                  )
                }
              >
                <option value="">None</option>
                <For each={CHOKE_GROUPS}>
                  {(group) => <option value={String(group)}>{group + 1}</option>}
                </For>
              </select>
            </label>

            <div class="pad-flags">
              <button
                type="button"
                class={["pad-flag", { active: pad().mixer.muted }]}
                aria-pressed={ariaBool(pad().mixer.muted)}
                aria-label={`Mute ${pad().name}`}
                onClick={() => toggleFlag(pad(), "muted")}
                title="Mute"
              >
                M
              </button>
              <button
                type="button"
                class={["pad-flag", { active: pad().mixer.soloed }]}
                aria-pressed={ariaBool(pad().mixer.soloed)}
                aria-label={`Solo ${pad().name}`}
                onClick={() => toggleFlag(pad(), "soloed")}
                title="Solo"
              >
                S
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={pads(props.track).length === 0}>
        <p class="drum-machine-empty">This track has no drum pads yet.</p>
      </Show>
    </section>
  );
}

interface PadControlProps {
  readonly trackId: Track["id"];
  readonly pad: DrumPad;
  readonly definition: ParameterDefinition;
  readonly label: string;
  readonly value: number;
  readonly displayValue: string;
  readonly bipolar?: boolean;
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
function PadControl(props: PadControlProps): JSX.Element {
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
      inputId={`pad-${props.pad.id}-${props.label.toLowerCase()}`}
      label={props.label}
      // Every pad shows a "Pitch", so the name has to say whose.
      ariaLabel={`${props.label} for ${props.pad.name}`}
      orientation="horizontal"
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
