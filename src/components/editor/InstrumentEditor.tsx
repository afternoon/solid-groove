import { type Component, Match, Switch } from "solid-js";
import type { Instrument } from "../../model/types";
import ClipInstrumentEditor from "./ClipInstrumentEditor";
import SamplerInstrumentEditor from "./SamplerInstrumentEditor";
import SynthInstrumentEditor from "./SynthInstrumentEditor";

type InstrumentEditorProps = {
	instrument: Instrument;
	trackIndex: number;
};

export default function InstrumentEditor(
	props: InstrumentEditorProps,
): Component<InstrumentEditorProps> {
	return (
		<div class="instrument-editor">
			<Switch>
				<Match when={props.instrument.type === "clip"}>
					<ClipInstrumentEditor
						instrument={props.instrument as Extract<Instrument, { type: "clip" }>}
						trackIndex={props.trackIndex}
					/>
				</Match>
				<Match when={props.instrument.type === "synth"}>
					<SynthInstrumentEditor
						instrument={props.instrument as Extract<Instrument, { type: "synth" }>}
						trackIndex={props.trackIndex}
					/>
				</Match>
				<Match when={props.instrument.type === "sampler"}>
					<SamplerInstrumentEditor
						instrument={
							props.instrument as Extract<Instrument, { type: "sampler" }>
						}
						trackIndex={props.trackIndex}
					/>
				</Match>
			</Switch>
		</div>
	);
}
