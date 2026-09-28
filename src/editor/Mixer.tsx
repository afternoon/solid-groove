import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidDocumentDuplicate, HiSolidTrash } from "solid-icons/hi";
import { createMemo, createSignal } from "solid-js";
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
  updateTrack,
} from "../commands";
import ConfirmDialog from "../components/ConfirmDialog";
import { duplicateTrack } from "../domain/duplicateTrack";
import type { Project, Track } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import { formatPan } from "../domain/faders";
import type { TrackId } from "../domain/ids";
import { TRACK_PAN } from "../domain/parameters";
import FillSlider from "../instrument/FillSlider";
import { instrumentKindSpec } from "../instrument/instrumentKinds";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import LevelMeter from "./LevelMeter";
import MasterPanel from "./MasterPanel";
import MasterStrip, { chainSummary } from "./MasterStrip";
import MuteSoloToggles from "./MuteSoloToggles";
import NewTrackButtons from "./NewTrackButtons";
import { type FaderProps, VolumeFader } from "./TrackFaders";
import type { TrackLevel } from "./trackLevels";
import "./trackDrag.css";
import {
  addTrackOfKind,
  instrumentTypeKey,
  type NewTrackKindSpec,
} from "./trackCreation";
import { moveTrack, type ReorderMethod } from "./trackReorder";
import { toggleTrackFlag, trackSurfaceHandlers } from "./trackSurface";
import { useTrackDrag } from "./useTrackDrag";
import "./Mixer.css";
import { ariaBool } from "../shared/aria";
import { type ShortcutHandlers, useShortcuts } from "../shortcuts";

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
  /** A track's live level, reactively (`useProjectAudio().trackLevel`). */
  trackLevel(trackId: TrackId): TrackLevel | null;
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
  /** The master's effects, which selecting the master strip takes you to. */
  let masterEffects: HTMLElement | undefined;
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
  function moveBy(trackId: TrackId, toIndex: number, method: ReorderMethod): void {
    moveTrack(
      { project: () => props.project, dispatch: props.dispatch, analytics: analytics() },
      trackId,
      toIndex,
      { view: "mixer", method },
    );
  }
  /** The track whose strip's Edit control has focus, and where a step of
   * `by` would move it — or undefined when there is none, or no room. */
  function focusedMove(by: -1 | 1): { trackId: TrackId; to: number } | undefined {
    const strip = document.activeElement
      ?.closest(".mixer-strip-select")
      ?.closest<HTMLElement>("[data-track-drag]");
    const trackId = strip?.dataset.trackDrag as TrackId | undefined;
    if (!trackId) return undefined;
    const to = trackIds().indexOf(trackId) + by;
    return to >= 0 && to < trackIds().length ? { trackId, to } : undefined;
  }

  /** Moves the focused strip a place, and keeps focus on it where it lands. */
  function moveFocused(by: -1 | 1): void {
    const move = focusedMove(by);
    if (!move) return;
    moveBy(move.trackId, move.to, "keyboard");
    queueMicrotask(() =>
      stripRow
        ?.querySelector<HTMLElement>(
          `[data-track-drag="${move.trackId}"] .mixer-strip-select`,
        )
        ?.focus(),
    );
  }

  // The keyboard's way to do what dragging a strip does (#447): the arrow
  // keys, while a strip's Edit control has focus. Anywhere else — a fader, the
  // pan, a name being typed — they keep their own meaning.
  useShortcuts({
    handlers: (): ShortcutHandlers => ({
      "track.move_left": {
        run: () => moveFocused(-1),
        isEnabled: () => focusedMove(-1) !== undefined,
      },
      "track.move_right": {
        run: () => moveFocused(1),
        isEnabled: () => focusedMove(1) !== undefined,
      },
    }),
    contexts: () => ["editor"],
  });

  let stripRow: HTMLDivElement | undefined;
  const trackDrag = useTrackDrag({
    axis: "x",
    zone: () => stripRow,
    indexOf: (trackId) => trackIds().indexOf(trackId),
    onDrop: (trackId, toIndex) => moveBy(trackId, toIndex, "drag"),
  });
  /** The strips in the order letting go now would leave them: a drag shows
   * the track already in its new place, rather than a marker where it would
   * go. The project only changes on release. */
  const shownIds = createMemo(() => {
    const dragged = trackDrag.dragging();
    const to = trackDrag.target();
    if (dragged === null || to === null) return trackIds();
    const ids = trackIds().filter((id) => id !== dragged);
    ids.splice(to, 0, dragged);
    return ids;
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
      {/* The view's title row (#447): what this page is, and the way to add
          to it at the right. */}
      <header class="mixer-header">
        <h2 class="mixer-heading">Mixer</h2>
        <NewTrackButtons label="Add track" onAdd={handleAddTrack} />
      </header>
      <div class="mixer-desk">
        <div class="mixer-tracks" ref={stripRow}>
          <For each={shownIds()}>
            {(id) => {
              const track = createMemo(() => trackById(id));
              return (
                <Show when={track()}>
                  {(current) => (
                    <TrackStrip
                      track={current()}
                      index={trackIds().indexOf(id)}
                      trackCount={trackIds().length}
                      clipCount={clipCount(id)}
                      selected={props.selectedTrackId === id}
                      onSelect={() => selectTrack(id)}
                      onMove={(toIndex) => moveBy(id, toIndex, "button")}
                      onDragStart={(event) => trackDrag.begin(event, id)}
                      dragging={trackDrag.dragging() === id}
                      previewing={
                        trackDrag.dragging() === id && trackDrag.target() !== null
                      }
                      dispatch={props.dispatch}
                      beginGesture={props.beginGesture}
                      trackLevel={props.trackLevel}
                      onDuplicate={() => handleDuplicate(current())}
                      onDelete={() => requestDelete(current())}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        </div>
        {/*
         * The master and its chain, always on screen (`UI-001`), at the end of
         * the strips where a console puts it. There is exactly one master, so
         * there is nothing to choose: the chain is never hidden behind a press.
         * The strip's name is still a control, like every track strip's, and
         * selecting it takes you to the master's effects (#283) — which on a
         * wide mix may be off to the side, and for a keyboard is the way in.
         */}
        <MasterStrip
          volume={props.project.song.master.volume}
          devices={props.project.song.master.devices}
          onSelect={() => {
            masterEffects?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            masterEffects?.focus();
            analytics().logFeatureFirstUse("mixer");
          }}
          onFirstUse={() => analytics().logFeatureFirstUse("mixer")}
          dispatch={props.dispatch}
          beginGesture={props.beginGesture}
        />
      </div>
      <div class="mixer-master">
        <MasterPanel
          sectionRef={(element) => {
            masterEffects = element;
          }}
          project={props.project}
          dispatch={props.dispatch}
          beginGesture={props.beginGesture}
          analytics={props.analytics}
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
  /** Start dragging this strip along the row, from anywhere on its
   * background or its "Edit" chip — see {@link startsStripDrag}. */
  onDragStart(event: PointerEvent): void;
  /** Whether this strip is the one being dragged. */
  readonly dragging: boolean;
  /** Whether it is being shown where letting go would move it. */
  readonly previewing: boolean;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  trackLevel(trackId: TrackId): TrackLevel | null;
  onDuplicate(): void;
  onDelete(): void;
}

/**
 * The strip's controls keep their own pointer gestures — a fader or pan drag,
 * a button press, text selection in the name. Anything else on the strip, and
 * its "Edit" chip, starts a reorder drag (#331): the whole strip background is
 * the handle, not an 18px chip.
 */
const STRIP_CONTROLS =
  "input, textarea, select, a, [role='slider'], .fill-slider, button:not(.mixer-strip-select)";

/** What a strip's select control reads: the track's instrument, or "Loop". */
function trackKindLabel(track: Track): string {
  if (track.type === "audio") return "Loop";
  return track.instrument ? instrumentKindSpec(track.instrument.kind).label : "Track";
}

function TrackStrip(props: TrackStripProps): JSX.Element {
  // Touching a strip selects its track (#447): a click anywhere on it, and
  // any value changed on it: a fader, the pan, mute, solo, the name. The Edit
  // button selects on its own; duplicate and delete act on the track, they do
  // not point the editor at it.
  const surface = trackSurfaceHandlers({
    selected: () => props.selected,
    onSelect: () => props.onSelect(),
    onDragStart: (event) => props.onDragStart(event),
    controls: STRIP_CONTROLS,
    clickExempt: ".mixer-strip-action, .mixer-strip-select",
  });

  const volumeDb = () => props.track.mixer.volume;
  const panValue = () => props.track.mixer.pan;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut for the strip's own Edit button
    // biome-ignore lint/a11y/useKeyWithClickEvents: the Edit button, and every control's own keys, are the keyboard path
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
      /* The previewed strip is the drop indicator: the mixer's drag shows
         where the track will land by putting it there. */
      data-testid={props.previewing ? "track-drop-indicator" : undefined}
      onPointerDown={surface.onPointerDown}
      onClick={surface.onClick}
      onInput={surface.onInput}
      onChange={surface.onChange}
    >
      {/* The track's colour runs across the strip's top edge (#447). */}
      <div class="mixer-strip-head" style={{ "border-top-color": props.track.color }}>
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
        {/* Selecting a track is this one control, reading the track's kind,
				    rather than a click anywhere on the strip: a container handler has
				    to fire on `pointerdown` to beat a fader drag, and WebKit then
				    swallowed the delete button's own click
				    (`tests/e2e/mock/mixer.spec.ts`). "Edit", not "Select": the
				    arrangement's accessible track list owns `Select <track>` for a bar
				    range, and `CF-002` clicks this one by name. */}
        <button
          type="button"
          class="mixer-strip-select"
          aria-pressed={ariaBool(props.selected)}
          aria-label={`Edit ${props.track.name}`}
          title={`Edit ${props.track.name}`}
          onClick={() => props.onSelect()}
        >
          {trackKindLabel(props.track)}
        </button>
      </div>

      <div class="mixer-strip-buttons">
        <button
          type="button"
          class="mixer-reorder mixer-reorder-up"
          aria-label={`Move ${props.track.name} left`}
          disabled={props.index === 0}
          onClick={() => props.onMove(props.index - 1)}
        >
          Move left
        </button>
        <button
          type="button"
          class="mixer-reorder mixer-reorder-down"
          aria-label={`Move ${props.track.name} right`}
          disabled={props.index >= props.trackCount - 1}
          onClick={() => props.onMove(props.index + 1)}
        >
          Move right
        </button>
        <MuteSoloToggles
          name={props.track.name}
          muted={props.track.mixer.muted}
          soloed={props.track.mixer.soloed}
          onToggle={(flag) => toggleTrackFlag(props.dispatch, props.track, flag)}
        />
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
          <LevelMeter trackId={props.track.id} trackLevel={props.trackLevel} />
        </div>
      </div>

      <div class="mixer-strip-actions">
        <span class="mixer-strip-chain" title={chainSummary(props.track.devices)}>
          {chainSummary(props.track.devices)}
        </span>
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

function trackTypeKey(track: Track): "instrument" | "audio" {
  return track.type;
}

function deleteWarning(clips: number): string {
  const noun = clips === 1 ? "clip" : "clips";
  return `This track has ${clips} ${noun}. Deleting it removes them too. This can be undone.`;
}
