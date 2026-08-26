import { For, type JSX } from "@solidjs/web";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { setParameter } from "../commands";
import type { Instrument } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import {
  bareParameterId,
  readInstrumentParameter,
  SAMPLER_AMP_ATTACK,
  SAMPLER_AMP_DECAY,
  SAMPLER_AMP_RELEASE,
  SAMPLER_AMP_SUSTAIN,
  SAMPLER_PITCH,
  SAMPLER_SAMPLE_END,
  SAMPLER_SAMPLE_START,
} from "../domain/parameters";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import FillSlider from "./FillSlider";
import { formatInstrumentValue } from "./formatValue";
import "./InstrumentPanel.css";

export interface SamplerPanelProps {
  readonly trackId: TrackId;
  readonly instrument: Extract<Instrument, { kind: "sampler" }>;
  /** Display name of the currently loaded sample, or null when empty. */
  readonly sampleName: string | null;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  audition(): void;
  readonly analytics?: Analytics;
}

const PLAYBACK_SLIDERS = [SAMPLER_PITCH, SAMPLER_SAMPLE_START, SAMPLER_SAMPLE_END];

const ENVELOPE_SLIDERS = [
  SAMPLER_AMP_ATTACK,
  SAMPLER_AMP_DECAY,
  SAMPLER_AMP_SUSTAIN,
  SAMPLER_AMP_RELEASE,
];

/**
 * The reusable one-shot sampler panel (PRD INS-01, mock `05b-sampler`): the
 * loaded sample, audition, and fill-sliders for pitch, sample start/end, and the
 * amp envelope (ADSR).
 *
 * A sound is chosen by dragging it here from the library (#225), which is why
 * the panel names the loaded sample rather than offering a list to swap
 * between: that list could only ever offer sounds the project already carried,
 * which for a new project is the one it started with. The drop itself belongs
 * to the surrounding `InstrumentArea`, named for its track so a drop lands on a
 * particular one; this panel stays a panel.
 *
 * Parameter edits dispatch a validated `parameter.set` in the `instrument`
 * scope; a continuous slider commits once per gesture, so a drag is one command
 * and emits nothing per tick.
 */
export default function SamplerPanel(props: SamplerPanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;

  function commit(parameterId: string, value: number): void {
    props.dispatch(
      setParameter({ scope: "instrument", trackId: props.trackId, parameterId }, value),
    );
    analytics().logFeatureFirstUse("sampler");
  }

  return (
    <section class="instrument-panel sampler-panel" aria-label="Sampler">
      <div class="instrument-panel-groups">
        <div class="instrument-panel-group sampler-sample-group">
          <h3 class="instrument-panel-heading">Sample</h3>
          {/* The sound's name, which is library copy rather than anything the
					    user typed — masked all the same, since a user-recorded sample
					    lands in the same slot (ADR 0002 decision 2). */}
          <p class={`sampler-sample-name ${MASK_CONTENT}`}>
            {props.sampleName ?? "No sample loaded"}
          </p>
          <p class="sampler-load-hint">Drag a sound here from the library</p>
        </div>
        <div class="instrument-panel-group instrument-panel-sliders">
          <h3 class="instrument-panel-heading">Playback</h3>
          <div class="instrument-panel-slider-row">
            <For each={PLAYBACK_SLIDERS}>{(definition) => sliderFor(definition)}</For>
          </div>
        </div>
        <div class="instrument-panel-group instrument-panel-sliders">
          <h3 class="instrument-panel-heading">Amp Envelope</h3>
          <div class="instrument-panel-slider-row">
            <For each={ENVELOPE_SLIDERS}>{(definition) => sliderFor(definition)}</For>
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

  function sliderFor(definition: (typeof PLAYBACK_SLIDERS)[number]): JSX.Element {
    const value = () => readInstrumentParameter(definition, props.instrument.parameters);
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
  }
}
