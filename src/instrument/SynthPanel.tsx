import { For, type JSX } from "@solidjs/web";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { setParameter } from "../commands";
import type { Instrument } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import {
  bareParameterId,
  readInstrumentParameter,
  SYNTH_AMP_ATTACK,
  SYNTH_AMP_DECAY,
  SYNTH_AMP_RELEASE,
  SYNTH_AMP_SUSTAIN,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
  SYNTH_WAVEFORM,
  SYNTH_WAVEFORMS,
  synthWaveform,
} from "../domain/parameters";
import FillSlider from "./FillSlider";
import { formatInstrumentValue } from "./formatValue";
import "./InstrumentPanel.css";
import OptionGroup from "./OptionGroup";
import { WaveformIcon } from "./waveformIcons";

export interface SynthPanelProps {
  readonly trackId: TrackId;
  readonly instrument: Extract<Instrument, { kind: "synth" }>;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Plays one preview note through the track. */
  audition(): void;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

const SLIDERS = [
  SYNTH_AMP_ATTACK,
  SYNTH_AMP_DECAY,
  SYNTH_AMP_SUSTAIN,
  SYNTH_AMP_RELEASE,
  SYNTH_FILTER_CUTOFF,
  SYNTH_FILTER_RESONANCE,
];

/**
 * The reusable synth voice panel (PRD INS-01, mock `05a-synth-voice`): an
 * oscillator waveform option group and vertical fill-sliders for the amp
 * envelope (ADSR) and the resonant low-pass filter (cutoff, resonance).
 *
 * Every control dispatches a validated `parameter.set` command in the
 * `instrument` scope — never a direct project mutation — so edits are
 * revision-checked and undoable, and the audio graph reuses its nodes with
 * smoothing. A continuous slider commits once per gesture (on release/blur), so
 * a drag is one command, one history entry, and emits nothing per tick;
 * `feature_first_use` for `synth` fires once, on the first edit, not per render.
 */
export default function SynthPanel(props: SynthPanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;

  function commit(parameterId: string, value: number): void {
    props.dispatch(
      setParameter({ scope: "instrument", trackId: props.trackId, parameterId }, value),
    );
    analytics().logFeatureFirstUse("synth");
  }

  const currentWaveform = () =>
    synthWaveform(readInstrumentParameter(SYNTH_WAVEFORM, props.instrument.parameters));

  return (
    <section class="instrument-panel synth-panel" aria-label="Synth voice">
      <div class="instrument-panel-groups">
        <div class="instrument-panel-group">
          <h3 class="instrument-panel-heading">Oscillator</h3>
          <OptionGroup
            legend="Waveform"
            value={currentWaveform()}
            options={SYNTH_WAVEFORMS.map((waveform) => ({
              value: waveform,
              label: capitalize(waveform),
              icon: <WaveformIcon waveform={waveform} />,
            }))}
            onSelect={(waveform) =>
              commit(
                bareParameterId(SYNTH_WAVEFORM.id),
                SYNTH_WAVEFORMS.indexOf(waveform),
              )
            }
          />
        </div>
        <div class="instrument-panel-group instrument-panel-sliders">
          <h3 class="instrument-panel-heading">Amp &amp; Filter</h3>
          <div class="instrument-panel-slider-row">
            <For each={SLIDERS}>
              {(definition) => {
                const value = () =>
                  readInstrumentParameter(definition, props.instrument.parameters);
                return (
                  <FillSlider
                    definition={definition}
                    value={value()}
                    displayValue={formatInstrumentValue(definition, value())}
                    onInput={() => {
                      /* live audio follows on commit; nothing per tick */
                    }}
                    onCommit={(next) => commit(bareParameterId(definition.id), next)}
                  />
                );
              }}
            </For>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="instrument-panel-audition"
        onClick={() => props.audition()}
      >
        Audition
      </button>
    </section>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
