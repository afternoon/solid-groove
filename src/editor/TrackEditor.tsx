import { type Accessor, Show } from "solid-js";
import type {
	Gesture,
	GestureOptions,
	RawCommandInput,
	TransactionResult,
} from "../commands";
import type { Clip, Instrument, Project } from "../domain/entities";
import type { EventId, TrackId } from "../domain/ids";
import type { SampleChoice } from "../instrument/SamplerPanel";
import InstrumentPanel from "./InstrumentPanel";
import PianoRoll, { type PianoRollActions } from "./PianoRoll";
import StepEditor from "./StepEditor";

export interface TrackEditorProps {
	readonly clip: Clip;
	readonly trackName: string | undefined;
	readonly packDependencyLabel: string | null;
	/** A synth track's note clip gets the CLP-03 piano roll instead of the grid. */
	readonly showPianoRoll: Accessor<boolean>;
	readonly instrument: Instrument | null;
	dispatch(
		commands: RawCommandInput | readonly RawCommandInput[],
	): TransactionResult | undefined;
	beginGesture(options?: GestureOptions): Gesture | undefined;
	readonly editorPlaybackStep: Accessor<number | null>;
	readonly selectedNoteIds: Accessor<readonly EventId[]>;
	readonly setSelectedNoteIds: (ids: readonly EventId[]) => void;
	readonly project: Project;
	readonly playheadTicks: number;
	readonly registerPianoRollActions: (actions: PianoRollActions) => void;
	/** Present only when the instrument gets a panel (sampler or synth). */
	readonly instrumentPanelTrackId: TrackId | null;
	readonly sampleName: string | null;
	readonly replacementOptions: readonly SampleChoice[];
	readonly auditionInstrument: () => void;
}

/**
 * One track's editing surface: track info (name, pack dependency), the
 * CLP-02 step grid or CLP-03 piano roll switch, and the instrument panel.
 *
 * Split out of `EditorView` (`REFACTOR-001`); every prop here mirrors the
 * exact value/handler `EditorView` used to close over directly, so this is a
 * pure structural move.
 */
export default function TrackEditor(props: TrackEditorProps) {
	return (
		<div class="track-editor">
			<div class="track-info">
				<span class="track-name">{props.trackName}</span>
				<Show when={props.packDependencyLabel}>
					<span class="pack-dependency">Pack: {props.packDependencyLabel}</span>
				</Show>
			</div>
			{/*
			 * A synth track's note clip gets the CLP-03 piano roll; everything
			 * else stays on LOOP-010's CLP-02 step editor. Pitched notes want two
			 * dimensions (pitch x time), which a one-row-per-step grid cannot show.
			 */}
			<Show
				when={props.showPianoRoll()}
				fallback={
					<StepEditor
						clip={props.clip}
						instrument={props.instrument}
						dispatch={props.dispatch}
						beginGesture={props.beginGesture}
						playbackStep={props.editorPlaybackStep}
						selectedIds={props.selectedNoteIds}
						setSelectedIds={props.setSelectedNoteIds}
					/>
				}
			>
				<PianoRoll
					clip={props.clip}
					project={props.project}
					dispatch={props.dispatch}
					beginGesture={props.beginGesture}
					playheadTicks={props.playheadTicks}
					registerActions={props.registerPianoRollActions}
				/>
			</Show>
			<Show when={props.instrumentPanelTrackId}>
				{(trackId) => (
					<InstrumentPanel
						trackId={trackId()}
						instrument={props.instrument}
						sampleName={props.sampleName}
						replacementOptions={props.replacementOptions}
						dispatch={props.dispatch}
						audition={props.auditionInstrument}
					/>
				)}
			</Show>
		</div>
	);
}
