import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidDocumentDuplicate, HiSolidTrash } from "solid-icons/hi";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import {
  addTrack,
  createControlGesture,
  removeTrack,
  setParameter,
  setTrackFlag,
  updateTrack,
} from "../commands";
import ConfirmDialog from "../components/ConfirmDialog";
import { duplicateTrack } from "../domain/duplicateTrack";
import type { Project, Track } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import {
  dbToFaderPosition,
  faderPositionToDb,
  formatDb,
  formatPan,
} from "../domain/faders";
import type { TrackId } from "../domain/ids";
import { TRACK_PAN, TRACK_VOLUME } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import DeviceChainSlot from "./DeviceChainSlot";
import NewTrackButtons from "./NewTrackButtons";
import TrackDropMarker from "./TrackDropMarker";
import {
  addTrackOfKind,
  instrumentTypeKey,
  type NewTrackKindSpec,
} from "./trackCreation";
import { moveTrack } from "./trackReorder";
import { useTrackDrag } from "./useTrackDrag";
import "./Mixer.css";
import { ariaBool } from "../shared/aria";

/**
 * The volume fader's own coordinate space: a normalized fader position, not the
 * decibels it writes. `src/domain/faders.ts` maps between the two so the travel
 * is perceptual rather than linear in dB.
 */
const FADER_RANGE = { min: 0, max: 1, step: 0.001 } as const;

/** Pan travels in the parameter's own bipolar range, in 1% steps. */
const PAN_RANGE = {
  min: TRACK_PAN.min,
  max: TRACK_PAN.max,
  step: 0.01,
} as const;

/** Mints IDs for tracks this mixer creates. A module singleton, not per-render. */
const factoryContext = createFactoryContext();

export interface MixerProps {
  readonly project: Project;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** Live post-fader level of a track, in dBFS, or null when no graph is up. */
  trackLevelDb(trackId: string): number | null;
  /** Whether playback is running — the meter only polls while it is. */
  isPlaying(): boolean;
  /**
   * The track the editor is showing, marked as selected here (#228). Optional,
   * like `onSelectTrack`: a mixer rendered without them still mixes, it just
   * marks no strip and moves nothing when one is clicked.
   */
  readonly selectedTrackId?: TrackId | null;
  /** Called with the track a strip belongs to when the user clicks it. */
  onSelectTrack?(trackId: TrackId): void;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
  /** Overrides the meter poll scheduler; injectable for tests. */
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

/**
 * The `LOOP-007` track manager and mixer (PRD `TRK-01`, `TRK-02`).
 *
 * Every track gets a channel strip: name (rename), reorder, duplicate, delete
 * (with a confirmation warning when the track has clips), mute, solo, a
 * perceptual volume fader with a human-readable dB readout, a pan control, and
 * a live level meter. Every change is a validated command dispatched through
 * the shared command layer — the mixer never mutates project state directly —
 * and volume/pan drags open a gesture so the whole drag commits as one history
 * entry, one revision, and at most one analytics event.
 */
export default function Mixer(props: MixerProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const tracks = createMemo(() =>
    [...props.project.song.tracks].sort((a, b) => a.order - b.order),
  );
  // A strip is keyed by its track's stable id, not the track object. Every
  // mixer command mints a new track object, so keying `<For>` on the object
  // would rebuild the whole strip on each edit — recreating the fader DOM
  // mid-drag and breaking the gesture. Keying on the id keeps each strip's DOM
  // stable across edits; the strip reads its track reactively by id.
  const trackIds = createMemo(() => tracks().map((track) => track.id));
  const trackById = (id: TrackId): Track | undefined =>
    props.project.song.tracks.find((track) => track.id === id);
  const [pendingDelete, setPendingDelete] = createSignal<Track | null>(null);
  function clipCount(trackId: TrackId): number {
    return props.project.clips.filter((clip) => clip.trackId === trackId).length;
  }

  /** Creating a track says which instrument it carries (#223), through the
   * one route the arrangement's buttons take too (`UI-001`). */
  function handleAddTrack(spec: NewTrackKindSpec): void {
    addTrackOfKind(spec.kind, {
      project: props.project,
      context: factoryContext,
      dispatch: props.dispatch,
      analytics: analytics(),
      feature: "mixer",
      onSelect: selectTrack,
    });
  }

  /**
   * Point the editor at a track (#228). Selection is the host's state, not the
   * mixer's, so this reports rather than decides; it counts as mixer use for
   * the OPS-02 `feature_first_use` measure, like every other strip interaction.
   */
  function selectTrack(trackId: TrackId): void {
    if (!props.onSelectTrack) return;
    props.onSelectTrack(trackId);
    analytics().logFeatureFirstUse("mixer");
  }

  /** Move a track, by its move-left/right buttons — the keyboard's route —
   * or by dragging its strip along the row (#331). */
  function moveBy(trackId: TrackId, toIndex: number, method: "button" | "drag"): void {
    moveTrack(
      { project: () => props.project, dispatch: props.dispatch, analytics: analytics() },
      trackId,
      toIndex,
      { view: "mixer", method },
    );
  }
  let stripRow: HTMLDivElement | undefined;
  const trackDrag = useTrackDrag({
    axis: "x",
    zone: () => stripRow,
    indexOf: (trackId) => trackIds().indexOf(trackId),
    onDrop: (trackId, toIndex) => moveBy(trackId, toIndex, "drag"),
  });

  function handleDuplicate(track: Track): void {
    const duplicate = duplicateTrack(props.project, track.id, {
      ids: factoryContext.ids,
    });
    props.dispatch(
      addTrack(duplicate.track, {
        clips: duplicate.clips,
        placements: duplicate.placements,
        automation: duplicate.automation,
      }),
    );
    analytics().log("track_added", {
      track_type: trackTypeKey(track),
      instrument_type: instrumentTypeKey(track.instrument),
    });
    analytics().logFeatureFirstUse("mixer");
  }

  function confirmDelete(): void {
    const track = pendingDelete();
    if (!track) return;
    props.dispatch(removeTrack(track.id));
    setPendingDelete(null);
  }

  function requestDelete(track: Track): void {
    // A track with clips warns before deletion (PRD TRK-01); an empty track is
    // removed immediately, matching how a low-risk delete needs no ceremony.
    if (clipCount(track.id) > 0) {
      setPendingDelete(track);
    } else {
      props.dispatch(removeTrack(track.id));
    }
  }

  return (
    <section class="mixer" aria-label="Mixer">
      <header class="mixer-header">
        <h3 class="mixer-heading">Mixer</h3>
        <span class="mixer-track-count">
          {trackIds().length} {trackIds().length === 1 ? "track" : "tracks"}
        </span>
        <NewTrackButtons label="Add track" onAdd={handleAddTrack} />
      </header>
      <div class="mixer-tracks" ref={stripRow}>
        <For each={trackIds()}>
          {(id, index) => {
            const track = createMemo(() => trackById(id));
            return (
              <Show when={track()}>
                {(current) => (
                  <TrackStrip
                    track={current()}
                    index={index()}
                    trackCount={trackIds().length}
                    clipCount={clipCount(id)}
                    selected={props.selectedTrackId === id}
                    onSelect={() => selectTrack(id)}
                    onMove={(toIndex) => moveBy(id, toIndex, "button")}
                    onDragStart={(event) => trackDrag.begin(event, id)}
                    dragging={trackDrag.dragging() === id}
                    dispatch={props.dispatch}
                    beginGesture={props.beginGesture}
                    trackLevelDb={props.trackLevelDb}
                    isPlaying={props.isPlaying}
                    onDuplicate={() => handleDuplicate(current())}
                    onDelete={() => requestDelete(current())}
                    requestFrame={props.requestFrame}
                    cancelFrame={props.cancelFrame}
                  />
                )}
              </Show>
            );
          }}
        </For>
        <TrackDropMarker axis="x" offset={trackDrag.marker()} />
      </div>
      {/* The master, at the end of the strips where a console puts it.
			    Selecting it is the route to its chain, which #283 fills. */}
      {/*
       * The master and its chain, always on screen (`UI-001`). It used to be
       * a button you pressed to reveal the chain, which made the one thing
       * every project has — and the one chain that is always there — the only
       * part of the mixer you had to go looking for. There is exactly one
       * master, so there is nothing to choose: showing it costs a strip's
       * width and saves a click every time.
       */}
      <div class="mixer-master">
        <h3 class="mixer-master-title">Master</h3>
        <DeviceChainSlot
          label="Master device chain"
          emptyMessage="No devices on the master yet."
        />
      </div>
      <Show when={pendingDelete()}>
        {(track) => (
          <ConfirmDialog
            title={`Delete "${track().name}"?`}
            message={deleteWarning(clipCount(track().id))}
            confirmLabel="Delete track"
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </Show>
    </section>
  );
}

interface TrackStripProps {
  readonly track: Track;
  readonly index: number;
  readonly trackCount: number;
  readonly clipCount: number;
  /** Whether this strip's track is the one the editor is showing (#228). */
  readonly selected: boolean;
  onSelect(): void;
  /** Move this strip's track to `toIndex` in display order. */
  onMove(toIndex: number): void;
  /** Start dragging this strip along the row, from its "Edit" chip. */
  onDragStart(event: PointerEvent): void;
  /** Whether this strip is the one being dragged. */
  readonly dragging: boolean;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  trackLevelDb(trackId: string): number | null;
  isPlaying(): boolean;
  onDuplicate(): void;
  onDelete(): void;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

function TrackStrip(props: TrackStripProps): JSX.Element {
  const volumeDb = () => props.track.mixer.volume;
  const panValue = () => props.track.mixer.pan;

  return (
    <div
      class={[
        "mixer-strip",
        {
          muted: props.track.mixer.muted,
          selected: props.selected,
          "track-dragging": props.dragging,
        },
      ]}
      data-track-drag={props.track.id}
    >
      <div class="mixer-strip-head">
        {/* The colour chip is also the keyboard route to selecting a track:
				    a pointer has the whole strip, a keyboard needs one focusable
				    control that says what it does. "Edit", not "Select": the
				    arrangement's accessible track list already owns `Select <track>`
				    for selecting a bar range, and two controls with one name would
				    leave a screen reader — and `CF-002`, which clicks it by that
				    name — unable to tell them apart. */}
        {/* Selecting a track is this one control, next to its name, rather
				    than a click anywhere on the strip. A container-level handler
				    reads nicer but has to fire on `pointerdown` to beat a fader
				    drag, and WebKit fires no click at all when mousedown and
				    mouseup land on different elements — so a re-render from that
				    handler swallowed the delete button's own click
				    (`tests/e2e/mock/mixer.spec.ts`). A real focusable control costs one
				    deliberate click and breaks nothing under it. */}
        <button
          type="button"
          class="mixer-strip-select"
          aria-pressed={ariaBool(props.selected)}
          aria-label={`Edit ${props.track.name}`}
          title={`Edit ${props.track.name}`}
          onClick={() => props.onSelect()}
          onPointerDown={(event) => props.onDragStart(event)}
        >
          <span
            class="mixer-strip-chip"
            style={{ "background-color": props.track.color }}
            aria-hidden="true"
          />
        </button>
        <label class="visually-hidden" for={`track-name-${props.track.id}`}>
          Track name
        </label>
        {/* The track's name, typed here (ADR 0002 decision 2). The rest of the
				    strip stays visible — that is the mixing replay exists to observe. */}
        <input
          id={`track-name-${props.track.id}`}
          class={`mixer-strip-name ${MASK_CONTENT}`}
          type="text"
          value={props.track.name}
          onChange={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== props.track.name) {
              props.dispatch(updateTrack(props.track.id, { name }));
            } else {
              event.currentTarget.value = props.track.name;
            }
          }}
        />
      </div>

      <div class="mixer-strip-buttons">
        <button
          type="button"
          class="mixer-strip-button mixer-reorder-up"
          aria-label={`Move ${props.track.name} left`}
          disabled={props.index === 0}
          onClick={() => props.onMove(props.index - 1)}
        >
          ‹
        </button>
        <button
          type="button"
          class="mixer-strip-button mixer-reorder-down"
          aria-label={`Move ${props.track.name} right`}
          disabled={props.index >= props.trackCount - 1}
          onClick={() => props.onMove(props.index + 1)}
        >
          ›
        </button>
        <button
          type="button"
          class={["mixer-strip-button mixer-mute", { active: props.track.mixer.muted }]}
          aria-pressed={ariaBool(props.track.mixer.muted)}
          aria-label={`Mute ${props.track.name}`}
          onClick={() =>
            props.dispatch(
              setTrackFlag(props.track.id, "muted", !props.track.mixer.muted),
            )
          }
        >
          M
        </button>
        <button
          type="button"
          class={["mixer-strip-button mixer-solo", { active: props.track.mixer.soloed }]}
          aria-pressed={ariaBool(props.track.mixer.soloed)}
          aria-label={`Solo ${props.track.name}`}
          onClick={() =>
            props.dispatch(
              setTrackFlag(props.track.id, "soloed", !props.track.mixer.soloed),
            )
          }
        >
          S
        </button>
      </div>

      <div class="mixer-strip-pan">
        <PanControl
          track={props.track}
          value={panValue()}
          dispatch={props.dispatch}
          beginGesture={props.beginGesture}
        />
      </div>

      <div class="mixer-strip-controls">
        <VolumeFader
          track={props.track}
          value={volumeDb()}
          dispatch={props.dispatch}
          beginGesture={props.beginGesture}
        />
        <div class="mixer-meter-column">
          <span class="mixer-meter-label" aria-hidden="true">
            Lvl
          </span>
          <LevelMeter
            trackId={props.track.id}
            trackLevelDb={props.trackLevelDb}
            isPlaying={props.isPlaying}
            requestFrame={props.requestFrame}
            cancelFrame={props.cancelFrame}
          />
        </div>
      </div>

      <div class="mixer-strip-actions">
        <button
          type="button"
          class="mixer-strip-action mixer-duplicate"
          aria-label={`Duplicate ${props.track.name}`}
          onClick={() => props.onDuplicate()}
        >
          <HiSolidDocumentDuplicate size={13} />
        </button>
        <button
          type="button"
          class="mixer-strip-action mixer-delete"
          aria-label={`Delete ${props.track.name}`}
          onClick={() => props.onDelete()}
        >
          <HiSolidTrash size={13} />
        </button>
      </div>
    </div>
  );
}

interface FaderProps {
  readonly track: Track;
  readonly value: number;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
}

function VolumeFader(props: FaderProps): JSX.Element {
  const position = () => dbToFaderPosition(TRACK_VOLUME, props.value);
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => `Set volume for ${props.track.name}`,
    command: (value) =>
      setParameter(
        {
          scope: "track",
          trackId: props.track.id,
          parameterId: TRACK_VOLUME.id,
        },
        faderPositionToDb(TRACK_VOLUME, value),
      ),
  });

  return (
    <FillSlider
      definition={TRACK_VOLUME}
      inputId={`mixer-volume-${props.track.id}`}
      label="Vol"
      ariaLabel={`Volume for ${props.track.name}`}
      range={FADER_RANGE}
      value={position()}
      displayValue={formatDb(TRACK_VOLUME, props.value)}
      onInput={(value) => control.input(value)}
      onCommit={(value) => control.commit(value)}
    />
  );
}

function PanControl(props: FaderProps): JSX.Element {
  const control = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => props.dispatch(commands),
    summary: () => `Set pan for ${props.track.name}`,
    command: (value) =>
      setParameter(
        { scope: "track", trackId: props.track.id, parameterId: TRACK_PAN.id },
        value,
      ),
  });

  return (
    <FillSlider
      definition={TRACK_PAN}
      inputId={`mixer-pan-${props.track.id}`}
      label="Pan"
      ariaLabel={`Pan for ${props.track.name}`}
      // Pan's range *is* the stereo field: left is left. A vertical fader
      // would ask the user to read "up" as "right", so this one control lies
      // on its side and fills out from centre.
      orientation="horizontal"
      bipolar
      range={PAN_RANGE}
      value={props.value}
      displayValue={formatPan(props.value)}
      onInput={(value) => control.input(value)}
      onCommit={(value) => control.commit(value)}
    />
  );
}

interface LevelMeterProps {
  readonly trackId: TrackId;
  trackLevelDb(trackId: string): number | null;
  isPlaying(): boolean;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

/** Floor of the meter display, in dBFS. Below this reads as silence. */
const METER_FLOOR_DB = -60;

function LevelMeter(props: LevelMeterProps): JSX.Element {
  const [levelDb, setLevelDb] = createSignal(METER_FLOOR_DB);
  const requestFrame =
    props.requestFrame ??
    ((callback) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => callback())
        : (setTimeout(callback, 33) as unknown as number));
  const cancelFrame =
    props.cancelFrame ??
    ((handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
      else clearTimeout(handle);
    });

  let frame: number | null = null;

  function poll(): void {
    if (!props.isPlaying()) {
      setLevelDb(METER_FLOOR_DB);
      frame = null;
      return;
    }
    const db = props.trackLevelDb(props.trackId);
    setLevelDb(db === null || !Number.isFinite(db) ? METER_FLOOR_DB : db);
    frame = requestFrame(poll);
  }

  // Restart the poll loop whenever playback begins; the loop stops itself when
  // playback ends (see `poll`). `props.isPlaying()` is the effect's only
  // reactive read, so it is the whole compute half; scheduling the frame is a
  // side effect and belongs in the apply half.
  createEffect(
    () => props.isPlaying(),
    (playing) => {
      if (playing && frame === null) {
        frame = requestFrame(poll);
      }
    },
  );

  // This stays a component-scoped `onCleanup` rather than riding the apply
  // half's return: it cancels an outstanding frame when the meter goes away,
  // not on every `isPlaying` change. Returning it from the apply would cancel
  // the loop the instant playback stopped, and `poll` would never get its
  // final tick to reset the meter to the floor.
  onCleanup(() => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  });

  const clamped = () => Math.max(METER_FLOOR_DB, Math.min(0, levelDb()));
  const fillFraction = () => (clamped() - METER_FLOOR_DB) / -METER_FLOOR_DB;

  // A native <meter> carries the level's role and value for assistive tech for
  // free (no hand-rolled ARIA to drift), while the custom bar overlay gives the
  // vertical VU look a bare <meter> can't be styled into. The two share one
  // value: the overlay's height is the same fraction the <meter> reports.
  return (
    <div class="mixer-meter">
      <meter
        class="visually-hidden"
        aria-label="Level"
        min={METER_FLOOR_DB}
        max={0}
        low={-18}
        high={-6}
        value={clamped()}
      />
      <div class="mixer-meter-fill" style={{ height: `${fillFraction() * 100}%` }} />
    </div>
  );
}

function trackTypeKey(track: Track): "instrument" | "audio" {
  return track.type;
}

function deleteWarning(clips: number): string {
  const noun = clips === 1 ? "clip" : "clips";
  return `This track has ${clips} ${noun}. Deleting it removes them too. This can be undone.`;
}
