import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidDocumentDuplicate, HiSolidPlus, HiSolidTrash } from "solid-icons/hi";
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
  reorderTrack,
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
import {
  createNewTrack,
  instrumentTypeKey,
  NEW_TRACK_KINDS,
  type NewTrackKindSpec,
} from "./trackCreation";
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

  // Creating a track says which instrument it carries (#223). The new track
  // arrives with an empty one-bar clip so it can be programmed straight away,
  // and the whole thing is one `track.add` command: one revision, one undo.
  function handleAddTrack(spec: NewTrackKindSpec): void {
    const added = createNewTrack(factoryContext, {
      kind: spec.kind,
      order: tracks().length,
      existingNames: tracks().map((track) => track.name),
    });
    props.dispatch(
      addTrack(added.track, {
        clips: [added.clip],
        placements: [added.placement],
      }),
    );
    analytics().log("track_added", {
      track_type: "instrument",
      instrument_type: spec.analyticsType,
    });
    analytics().logFeatureFirstUse("mixer");
    // A track you just added is the one you want to set up, so the editor
    // follows it rather than staying on whatever was on screen (#228).
    selectTrack(added.track.id);
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
        {/* One button per instrument rather than one "Add track" plus a kind
				    picker: adding a track is a two-decision action ("another track",
				    "a sampler"), and a button per kind makes the second decision the
				    click itself instead of a mode set beforehand. */}
        <fieldset class="mixer-add-track-group" aria-label="Add track">
          <For each={NEW_TRACK_KINDS}>
            {(spec) => (
              <button
                type="button"
                class="mixer-add-track"
                aria-label={spec.actionLabel}
                title={spec.actionLabel}
                onClick={() => handleAddTrack(spec)}
              >
                <HiSolidPlus size={13} />
                <span>{spec.label}</span>
              </button>
            )}
          </For>
        </fieldset>
      </header>
      <div class="mixer-tracks">
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
        { muted: props.track.mixer.muted, selected: props.selected },
      ]}
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
          onClick={() => props.dispatch(reorderTrack(props.track.id, props.index - 1))}
        >
          ‹
        </button>
        <button
          type="button"
          class="mixer-strip-button mixer-reorder-down"
          aria-label={`Move ${props.track.name} right`}
          disabled={props.index >= props.trackCount - 1}
          onClick={() => props.dispatch(reorderTrack(props.track.id, props.index + 1))}
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
