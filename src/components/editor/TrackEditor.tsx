import type { Component } from "solid-js";
import type { Sequence, Track } from "../../model/types";
import InstrumentEditor from "./InstrumentEditor";
import SequenceEditor from "./SequenceEditor";

type TrackEditorProps = {
	track: Track;
	sequence: Sequence;
	trackIndex: number;
};

export default function TrackEditor(
	props: TrackEditorProps,
): Component<TrackEditorProps> {
	return (
		<div class="track-editor">
			<div class="track-info">
				<span class="track-name">{props.track.name}</span>
			</div>
			<InstrumentEditor
				instrument={props.track.instrument}
				trackIndex={props.trackIndex}
			/>
			<SequenceEditor sequence={props.sequence} trackIndex={props.trackIndex} />
		</div>
	);
}
