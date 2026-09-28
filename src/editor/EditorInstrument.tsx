import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Asset, Clip, Instrument, Project, Track } from "../domain/entities";
import type { PadId, TrackId } from "../domain/ids";
import InstrumentKindPicker from "../instrument/InstrumentKindPicker";
import type { WatchPeaks } from "../instrument/SampleWell";
import type { LibrarySample } from "../library/assetDrag";
import DeviceChainPanel from "./DeviceChainPanel";
import DrumMachinePanel from "./DrumMachinePanel";
import InstrumentHeader from "./InstrumentHeader";
import { instrumentHeaderFacts } from "./instrumentHeader";
import LoopPanel from "./LoopPanel";
import TrackInstrument from "./TrackInstrument";
import TrackRail from "./TrackRail";
import "./EditorInstrument.css";

export interface EditorInstrumentProps {
  readonly project: Project;
  /** The selected track, or null while the project has none. */
  readonly track: Track | null;
  /** That track when it carries a drum machine, which gets its own pad grid. */
  readonly drumTrack: Track | null;
  readonly sampleAssets: readonly Asset[];
  readonly instrument: Instrument | null;
  readonly instrumentTrackId: TrackId | null;
  readonly sampleName: string | null;
  readonly loadSample: (sample: LibrarySample) => void;
  readonly audition: () => void;
  readonly auditionPad: (trackId: TrackId, padId: PadId) => void;
  /** Opens the library on the sampler's sample slot (`UI-001`). */
  readonly onBrowse: () => void;
  /** Opens the library on one drum pad's sample slot (#447). */
  readonly onBrowsePad?: (trackId: TrackId, padId: PadId) => void;
  /** Follows a sound's decoded waveform for the sampler's well (#447). */
  readonly watchPeaks?: WatchPeaks;
  onSelectTrack(trackId: TrackId): void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

/** A track's tempo-labelled loop and the asset it plays, when it has one. */
function trackLoop(
  project: Project,
  track: Track,
): { clip: Clip | null; asset: Asset | null } {
  const clip =
    project.clips.find(
      (candidate) =>
        candidate.trackId === track.id && candidate.content.kind === "audioLoop",
    ) ?? null;
  const assetId = clip?.content.kind === "audioLoop" ? clip.content.assetId : null;
  const asset = project.song.assets.find((candidate) => candidate.id === assetId) ?? null;
  return { clip, asset };
}

/**
 * The Instrument view (`UI-001`): one track's sound, and nothing else.
 *
 * One job at a time is the whole bet — the timeline is not merely hidden behind
 * this, it is not on the page — so the instrument gets the room a panel wedged
 * under the arrangement never had. The rail down the left edge is how you move
 * between tracks here, since the arrangement's headers and the mixer's strips
 * are both on other pages now.
 *
 * The selected track's device chain sits beneath the instrument (#241), in the
 * slot UI-001 reserved for it. It reads the same selected track as everything
 * else here, so the rail, the mixer and the arrangement all move it; there is
 * no second selection. The master's chain is #283's, in the mixer.
 */
export default function EditorInstrument(props: EditorInstrumentProps): JSX.Element {
  // The drum pad the pad editor shows, lifted here so the header can name it
  // and audition it (#447). A pad the track lacks reads as its first.
  const [selectedPad, setSelectedPad] = createSignal<PadId | null>(null);

  /** The header's Audition: the selected pad on a drum machine, else the instrument. */
  function audition(track: Track) {
    if (track.type === "audio" || !track.instrument) return undefined;
    const instrument = track.instrument;
    if (instrument.kind !== "drumMachine") {
      return { label: "Audition", run: () => props.audition() };
    }
    return {
      label: "Audition pad",
      run: () => {
        const pad =
          instrument.pads.find((candidate) => candidate.id === selectedPad()) ??
          instrument.pads[0];
        if (pad) props.auditionPad(track.id, pad.id);
      },
    };
  }

  /** The header row every instrument unit opens with (#447). */
  const header = (track: Track) => (
    <InstrumentHeader
      facts={instrumentHeaderFacts(props.project, track, selectedPad())}
      trackName={track.name}
      audition={audition(track)}
    />
  );

  return (
    <div class="instrument-view">
      <TrackRail
        tracks={props.project.song.tracks}
        selectedTrackId={props.track?.id ?? null}
        onSelect={props.onSelectTrack}
      />
      <div class="instrument-view-body">
        <Show
          when={props.track}
          fallback={
            <p class="no-track">This project has no tracks yet. Add one in the mixer.</p>
          }
        >
          {(currentTrack) => (
            // The track's own colour is the ink its wells draw in (#447).
            <div
              class="instrument-view-track"
              style={{ "--track-ink": currentTrack().color }}
            >
              {/* The kind picker heads the view, outside the instrument it
                  chooses (#447). A loop track has no instrument to pick. */}
              <Show when={currentTrack().type !== "audio" && props.instrumentTrackId}>
                {(trackId) => (
                  <InstrumentKindPicker
                    trackId={trackId()}
                    project={props.project}
                    instrument={props.instrument}
                    dispatch={props.dispatch}
                  />
                )}
              </Show>
              {/* An audio track plays a loop, so it shows the loop's faceplate
                  (#447). Either way the header row is the unit's first row. */}
              <Show
                when={currentTrack().type === "audio"}
                fallback={
                  <TrackInstrument
                    trackName={currentTrack().name}
                    instrument={props.instrument}
                    trackId={props.instrumentTrackId}
                    sampleName={props.sampleName}
                    loadSample={props.loadSample}
                    onBrowse={props.onBrowse}
                    watchPeaks={props.watchPeaks}
                    dispatch={props.dispatch}
                    beginGesture={props.beginGesture}
                    header={header(currentTrack())}
                  >
                    <Show when={props.drumTrack}>
                      {(drum) => (
                        <div class="drum-machine-editor">
                          <DrumMachinePanel
                            track={drum()}
                            assets={props.sampleAssets}
                            dispatch={props.dispatch}
                            beginGesture={props.beginGesture}
                            audition={(padId) => props.auditionPad(drum().id, padId)}
                            selectedPadId={selectedPad()}
                            onSelectPad={setSelectedPad}
                            onBrowseSample={(padId) =>
                              props.onBrowsePad?.(drum().id, padId)
                            }
                            watchPeaks={props.watchPeaks}
                          />
                        </div>
                      )}
                    </Show>
                  </TrackInstrument>
                }
              >
                <LoopPanel
                  trackName={currentTrack().name}
                  clip={trackLoop(props.project, currentTrack()).clip}
                  asset={trackLoop(props.project, currentTrack()).asset}
                  songTempo={props.project.song.tempo}
                  watchPeaks={props.watchPeaks}
                  header={header(currentTrack())}
                />
              </Show>
              <DeviceChainPanel
                track={currentTrack()}
                tempo={props.project.song.tempo}
                dispatch={props.dispatch}
                beginGesture={props.beginGesture}
              />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
