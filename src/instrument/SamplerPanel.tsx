import { For, type JSX, Show } from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { setParameter, setSample } from "../commands";
import type { Instrument } from "../domain/entities";
import type { AssetId, TrackId } from "../domain/ids";
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

/** A sample the user can load into the sampler (from the project's assets). */
export interface SampleChoice {
	readonly assetId: AssetId;
	readonly name: string;
}

export interface SamplerPanelProps {
	readonly trackId: TrackId;
	readonly instrument: Extract<Instrument, { kind: "sampler" }>;
	/** Display name of the currently loaded sample, or null when empty. */
	readonly sampleName: string | null;
	/** Samples the user can swap to; retired for the drop in the next PR. */
	readonly replacementOptions: readonly SampleChoice[];
	dispatch(
		commands: RawCommandInput | readonly RawCommandInput[],
	): TransactionResult | undefined;
	audition(): void;
	readonly analytics?: Analytics;
}

const PLAYBACK_SLIDERS = [
	SAMPLER_PITCH,
	SAMPLER_SAMPLE_START,
	SAMPLER_SAMPLE_END,
];

const ENVELOPE_SLIDERS = [
	SAMPLER_AMP_ATTACK,
	SAMPLER_AMP_DECAY,
	SAMPLER_AMP_SUSTAIN,
	SAMPLER_AMP_RELEASE,
];

/**
 * The reusable one-shot sampler panel (PRD INS-01, mock `05b-sampler`): sample
 * selection + audition, and fill-sliders for pitch, sample start/end, and the
 * amp envelope (ADSR).
 *
 * A sound is loaded by dragging it here from the library (#225), but this panel
 * owns none of that: the drop target is the surrounding `InstrumentArea`, which
 * is named for its track so a drop lands on a particular one and which catches a
 * drop anywhere in the track's instrument controls. This panel stays a panel.
 *
 * Parameter edits dispatch a validated `parameter.set` in the `instrument`
 * scope; a sample swap dispatches `instrument.setSample`, whose inverse restores
 * the previous asset so replacement is undoable and preserves the rest of the
 * sampler's settings. Replacing the sample emits `instrument_changed`
 * (`sampler`) and the `sampler` `feature_first_use` key. A continuous slider
 * commits once per gesture, so a drag is one command and emits nothing per tick.
 */
export default function SamplerPanel(props: SamplerPanelProps): JSX.Element {
	const analytics = () => props.analytics ?? defaultAnalytics;

	function commit(parameterId: string, value: number): void {
		props.dispatch(
			setParameter(
				{ scope: "instrument", trackId: props.trackId, parameterId },
				value,
			),
		);
		analytics().logFeatureFirstUse("sampler");
	}

	function replaceSample(assetId: AssetId): void {
		if (assetId === props.instrument.assetId) return;
		const result = props.dispatch(setSample(props.trackId, assetId));
		if (!result?.ok) return;
		analytics().log("instrument_changed", { instrument_type: "sampler" });
		analytics().logFeatureFirstUse("sampler");
	}

	return (
		<section class="instrument-panel sampler-panel" aria-label="Sampler">
			<div class="instrument-panel-groups">
				<div class="instrument-panel-group">
					<h3 class="instrument-panel-heading">Sample</h3>
					{/* The sound's name, which is library copy rather than anything the
					    user typed — masked all the same, since a user-recorded sample
					    lands in the same slot (ADR 0002 decision 2). */}
					<p class={`sampler-sample-name ${MASK_CONTENT}`}>
						{props.sampleName ?? "No sample loaded"}
					</p>
					<Show when={props.replacementOptions.length > 0}>
						<label class="sampler-load">
							<span class="visually-hidden">Load sample</span>
							<select
								class="sampler-load-select"
								value={props.instrument.assetId ?? ""}
								onChange={(event) => {
									const value = event.currentTarget.value;
									if (value) replaceSample(value as AssetId);
								}}
							>
								<option value="" disabled>
									Load…
								</option>
								<For each={props.replacementOptions}>
									{(choice) => (
										<option value={choice.assetId}>{choice.name}</option>
									)}
								</For>
							</select>
						</label>
					</Show>
				</div>
				<div class="instrument-panel-group instrument-panel-sliders">
					<h3 class="instrument-panel-heading">Playback</h3>
					<div class="instrument-panel-slider-row">
						<For each={PLAYBACK_SLIDERS}>
							{(definition) => sliderFor(definition)}
						</For>
					</div>
				</div>
				<div class="instrument-panel-group instrument-panel-sliders">
					<h3 class="instrument-panel-heading">Amp Envelope</h3>
					<div class="instrument-panel-slider-row">
						<For each={ENVELOPE_SLIDERS}>
							{(definition) => sliderFor(definition)}
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

	function sliderFor(
		definition: (typeof PLAYBACK_SLIDERS)[number],
	): JSX.Element {
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
	}
}
