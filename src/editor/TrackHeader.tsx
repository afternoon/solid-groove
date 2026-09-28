import type { JSX } from "@solidjs/web";
import type { Analytics } from "../analytics/analytics";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Track } from "../domain/entities";
import type { TrackId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import LevelMeter from "./LevelMeter";
import MuteSoloToggles from "./MuteSoloToggles";
import TrackColorPicker from "./TrackColorPicker";
import { VolumeFader } from "./TrackFaders";
import type { TrackLevel } from "./trackLevels";
import "./TrackHeader.css";
import { toggleTrackFlag, trackSurfaceHandlers } from "./trackSurface";

export interface TrackHeaderProps {
  readonly track: Track;
  /** Whether the editor is showing this track. */
  readonly selected: boolean;
  /** Points the editor at this track. */
  onSelect(): void;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** A track's live level, reactively (`useProjectAudio().trackLevel`). */
  trackLevel(trackId: TrackId): TrackLevel | null;
  /** Starts a reorder drag, from anywhere on the header but its controls. */
  onDragStart?(event: PointerEvent): void;
  /** Where the header is shown, so its fader's id is its own. */
  readonly surface: "arrangement" | "instrument";
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/** What a press on starts no drag from: the header's own controls. */
const CONTROLS = "input, button:not(.track-header-select), [role='slider'], .fill-slider";

/**
 * A track's header (#447): one component for the arrangement's header column
 * and the instrument view's rail, so a track looks and sits the same in both
 * and moving between them moves nothing. The swatch and the name, bold, then
 * Mute and Solo; the track's volume along the row; its live level under it.
 *
 * Touching a header selects its track, as a mixer strip does: a click on it,
 * and any value changed on it. The name is the "Edit <track>" control, which
 * a keyboard tabs to and the core flows click by name.
 */
export default function TrackHeader(props: TrackHeaderProps): JSX.Element {
  const surface = trackSurfaceHandlers({
    selected: () => props.selected,
    onSelect: () => props.onSelect(),
    onDragStart: (event) => props.onDragStart?.(event),
    controls: CONTROLS,
    clickExempt: ".track-header-select",
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut for the header's own Edit button
    // biome-ignore lint/a11y/useKeyWithClickEvents: the Edit button, and every control's own keys, are the keyboard path
    <div
      class={[
        "track-header",
        { selected: props.selected, muted: props.track.mixer.muted },
      ]}
      style={{ "--track-ink": props.track.color }}
      onPointerDown={surface.onPointerDown}
      onClick={surface.onClick}
      onInput={surface.onInput}
      onChange={surface.onChange}
    >
      <div class="track-header-title">
        <TrackColorPicker
          track={props.track}
          dispatch={props.dispatch}
          analytics={props.analytics}
        />
        <button
          type="button"
          class="track-header-select"
          aria-pressed={ariaBool(props.selected)}
          aria-label={`Edit ${props.track.name}${props.track.mixer.muted ? " (muted)" : ""}`}
          onClick={() => props.onSelect()}
        >
          {/* The track's name, chosen by the user (ADR 0002 decision 2). */}
          <span class={`track-header-name ${MASK_CONTENT}`}>{props.track.name}</span>
        </button>
        <MuteSoloToggles
          name={props.track.name}
          muted={props.track.mixer.muted}
          soloed={props.track.mixer.soloed}
          onToggle={(flag) => toggleTrackFlag(props.dispatch, props.track, flag)}
        />
      </div>
      <VolumeFader
        track={props.track}
        value={props.track.mixer.volume}
        dispatch={props.dispatch}
        beginGesture={props.beginGesture}
        inputId={`${props.surface}-volume-${props.track.id}`}
        orientation="horizontal"
      />
      <LevelMeter
        trackId={props.track.id}
        trackLevel={props.trackLevel}
        orientation="horizontal"
      />
    </div>
  );
}
