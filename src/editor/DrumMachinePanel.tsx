import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidPlus } from "solid-icons/hi";
import { createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import {
  addPad,
  createControlGesture,
  MAX_DRUM_PADS,
  setPadAsset,
  setPadChoke,
  setPadFlag,
  setPadParameter,
} from "../commands";
import type { Asset, DrumPad, Track } from "../domain/entities";
import {
  createDrumPad,
  createFactoryContext,
  type DomainFactoryContext,
} from "../domain/factories";
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
import SamplePicker from "../instrument/SamplePicker";
import { createPeaks, peakBars, type WatchPeaks } from "../instrument/SampleWell";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import PadSound from "./PadSound";
import "./DrumMachinePanel.css";
import "./NewTrackButtons.css";
import { ariaBool } from "../shared/aria";

/** Bars in a pad's waveform preview. */
const PREVIEW_BUCKETS = 56;

/** Mints the IDs of pads this panel adds. A module singleton. */
const defaultFactoryContext = createFactoryContext();

/** The first "Pad N" no pad on the machine is already called. */
export function nextPadName(existing: readonly DrumPad[]): string {
  const taken = new Set(existing.map((pad) => pad.name));
  let n = existing.length + 1;
  while (taken.has(`Pad ${n}`)) n++;
  return `Pad ${n}`;
}

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
  /** Follows each pad's sound for its waveform preview (#447). */
  readonly watchPeaks?: WatchPeaks;
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
  /** Overrides the pad-ID factory so tests are deterministic. */
  readonly factoryContext?: DomainFactoryContext;
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

  // The pad shown in the editor above the table (#447). UI-only and
  // session-local, like any selection; a pad that goes away hands it back to
  // the first pad.
  const [chosenPad, setChosenPad] = createSignal<PadId | null>(null);
  const selectedPad = () => {
    const all = pads(props.track);
    return all.find((pad) => pad.id === chosenPad()) ?? all[0];
  };

  const full = () => pads(props.track).length >= MAX_DRUM_PADS;

  /** Adds an empty pad at the end and selects it, so its sample is the next pick. */
  function addNewPad(): void {
    markFeatureUse();
    const pad = createDrumPad(props.factoryContext ?? defaultFactoryContext, {
      name: nextPadName(pads(props.track)),
    });
    if (props.dispatch(addPad(props.track.id, pad))?.ok) setChosenPad(pad.id);
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
      {/* The one pad editor (#447): whichever pad is selected, above the
          table, rather than a panel folding open under each row. */}
      <Show when={selectedPad()}>
        {(pad) => (
          <section class="drum-pad-editor" aria-label={`${pad().name} pad`}>
            <div class="drum-pad-editor-head">
              <span class="drum-pad-editor-name">{pad().name}</span>
              <div class="drum-pad-editor-sample">
                <SamplePicker
                  label={`Sample for ${pad().name}`}
                  current={pad().assetId}
                  assets={props.assets}
                  allowNone
                  onChoose={(assetId) => changePadAsset(pad(), assetId)}
                />
              </div>
            </div>
            <PadSound
              track={props.track}
              pad={pad()}
              asset={props.assets.find((asset) => asset.id === pad().assetId)}
              watchPeaks={props.watchPeaks}
              dispatch={props.dispatch}
              beginGesture={props.beginGesture}
              onFirstUse={markFeatureUse}
            />
          </section>
        )}
      </Show>
      {/* Keyed on the pad's own id, so an edit to a pad updates its lane in
			    place. Keyed on the pad *object* — the default — every parameter edit
			    rebuilds that lane, and a drag applying live would lose the very input
			    it is moving on its first sample. */}
      <Show when={pads(props.track).length > 0}>
        {/* Column names, read by eye. Each control carries its own full
				    name ("Pitch for BD"), so this row is hidden from assistive tech. */}
        <div class="drum-pad drum-pad-head" aria-hidden="true">
          <span>#</span>
          <span>Pad</span>
          <span>Sample</span>
          <span>Preview</span>
          <span>Pitch</span>
          <span>Level</span>
          <span>Pan</span>
          <span>Choke</span>
          <span>M · S</span>
        </div>
      </Show>
      <For each={pads(props.track)} keyed={(pad) => pad.id}>
        {(pad, index) => (
          // A press anywhere on a row selects its pad; the name button is the
          // same thing for the keyboard.
          // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut for the row's own name button
          // biome-ignore lint/a11y/useKeyWithClickEvents: the name button is the keyboard path
          <div
            class={["drum-pad", { muted: pad().mixer.muted }]}
            aria-current={selectedPad()?.id === pad().id ? "true" : undefined}
            onClick={() => setChosenPad(pad().id)}
          >
            <span class="pad-index">{String(index() + 1).padStart(2, "0")}</span>
            <button
              type="button"
              class="pad-audition"
              onClick={() => {
                setChosenPad(pad().id);
                audition(pad());
              }}
              aria-label={`Audition ${pad().name}`}
              title={`Audition ${pad().name}`}
            >
              <span class="pad-name">{pad().name}</span>
            </button>

            {/* The row names its sound; choosing one is the editor's job. */}
            <span class={`pad-sample ${MASK_CONTENT}`}>
              {props.assets.find((asset) => asset.id === pad().assetId)?.name ?? "None"}
            </span>

            <PadPreview
              name={pad().name}
              assetId={pad().assetId}
              watchPeaks={props.watchPeaks}
              onPlay={() => audition(pad())}
            />

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
      <div class="drum-machine-adds">
        <button
          type="button"
          class="new-track-button"
          aria-label={`Add pad to ${props.track.name}`}
          disabled={full()}
          onClick={addNewPad}
        >
          <HiSolidPlus size={13} />
          <span>Add pad</span>
        </button>
        <Show when={full()}>
          <span class="drum-machine-empty">
            A drum machine holds at most {MAX_DRUM_PADS} pads.
          </span>
        </Show>
      </div>
    </section>
  );
}

/**
 * A pad's sound in miniature (#447): its decoded waveform, and a press plays
 * it, as the pad's name does.
 */
function PadPreview(props: {
  readonly name: string;
  readonly assetId: AssetId | null;
  readonly watchPeaks?: WatchPeaks;
  onPlay(): void;
}): JSX.Element {
  const peaks = createPeaks(
    () => props.watchPeaks,
    () => props.assetId,
    PREVIEW_BUCKETS,
  );
  return (
    <button
      type="button"
      class="pad-preview"
      aria-label={`Preview ${props.name}`}
      onClick={() => props.onPlay()}
    >
      <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
        <path
          class="sample-well-bars playing"
          d={peaks() ? peakBars(peaks() as Float32Array, 120, 28) : ""}
        />
      </svg>
    </button>
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
