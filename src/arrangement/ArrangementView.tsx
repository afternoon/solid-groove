import { For, Show } from "@solidjs/web";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
} from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import type { Project } from "../domain/entities";
import { createIdFactory, type TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ArrangementToolbar } from "./ArrangementToolbar";
import { type ArrangementShell, createArrangementShell } from "./arrangementShell";
import {
  createArrangementWaveformCache,
  type InteractionState,
  RULER_HEIGHT_PX,
} from "./canvasRenderer";
import type { RowMetrics, Viewport } from "./geometry";
import { PlacementToolbar } from "./PlacementToolbar";
import {
  createPlacementEditing,
  type EditingGesture,
  type PlacementEditing,
} from "./placementEditingController";
import { type ArrangementProjection, buildArrangementProjection } from "./projection";
import { useArrangementCanvas } from "./useArrangementCanvas";
import "./ArrangementView.css";

/** The placement-editing operations `EditorView` wires into the KEY-01
 * registry and a duplicate-mode toolbar, mirroring `PianoRollActions`. */
export type PlacementEditingActions = PlacementEditing;

/**
 * The production arrangement editor shell (`ARR-001`; PRD ARR-01, section 9.3).
 *
 * A hybrid DOM + Canvas 2D surface built on the retained FND-008 renderer
 * contracts and the framework-free `ArrangementShell` controller. It provides:
 *
 * - three stacked, dirty-tracked, viewport-sized canvas layers (background grid
 *   + ruler, content clips, interaction playhead/selection/hover), each redrawn
 *   only for its own dirty reason and never on a permanent animation loop;
 * - a native scroll container with a logical-size spacer, so scrollbars,
 *   trackpads, and assistive tech keep browser-native behavior, and canvas
 *   backing stores that resize only on viewport/DPR change (DPR capped at 2);
 * - virtualized DOM track headers windowed to the visible rows, sharing the
 *   shell's row metrics and scroll;
 * - a transport-driven playhead that follows during playback, and a bar-range
 *   selection overlay;
 * - named DOM actions (zoom in/out, zoom to selection, scroll to playhead) and
 *   an accessible, virtualized track/selection list, so canvas pixels are never
 *   the sole representation of state (PRD 9.3 accessibility).
 *
 * Placement create/move/resize editing (`ARR-002`), section editing
 * (`ARR-003`), and automation editing (`ARR-004`) build their transient
 * gestures on this shell.
 */

/** Uniform per-row sizing. Header height equals the canvas row height so the
 * windowed header column lines up pixel-for-pixel with the timeline. */
export const ROW_METRICS: RowMetrics = {
  trackHeightPx: 28,
  headerHeightPx: 28,
};

const HEADER_WIDTH_PX = 160;
const INITIAL_PIXELS_PER_TICK = 0.08;

export interface ArrangementViewProps {
  readonly project: Project;
  /** Live playhead position in ticks (from the transport). */
  readonly playheadTicks?: Accessor<number>;
  /** Whether the transport is playing, so the playhead follows only then. */
  readonly isPlaying?: Accessor<boolean>;
  readonly analytics?: Analytics;
  /**
   * The shared command layer (`ARR-002`). Optional so existing callers/tests
   * that only exercise the ARR-001 shell keep working; placement editing is
   * inert without it.
   */
  readonly dispatch?: (
    commands: RawCommandInput | readonly RawCommandInput[],
  ) => TransactionResult | undefined;
  readonly beginGesture?: (options?: GestureOptions) => Gesture | undefined;
  /** Called once with the placement-editing operations, so `EditorView` can
   * wire them into the KEY-01 registry, mirroring `registerPianoRollActions`. */
  readonly onEditingActionsReady?: (actions: PlacementEditingActions | null) => void;
  /**
   * The track the editor is showing, marked in the header column (#228).
   * Optional, like `onSelectTrack`: without them the arrangement still works,
   * it just marks no row and moves nothing when one is clicked.
   */
  readonly selectedTrackId?: TrackId | null;
  /** Called with the track a clicked row belongs to, so the editor can follow
   * it — the arrangement holds no selection state of its own. */
  readonly onSelectTrack?: (trackId: TrackId) => void;
}

export default function ArrangementView(props: ArrangementViewProps) {
  const analytics = () => props.analytics ?? defaultAnalytics;

  const projection = createMemo<ArrangementProjection>(() =>
    buildArrangementProjection(props.project, ROW_METRICS),
  );

  // A tiny signal bumped whenever the shell mutates viewport/selection state,
  // so the reactive header column and accessible list re-read the shell.
  const [stateVersion, setStateVersion] = createSignal(0);

  let scrollEl!: HTMLDivElement;
  let headerListEl!: HTMLUListElement;
  let backgroundCanvas!: HTMLCanvasElement;
  let contentCanvas!: HTMLCanvasElement;
  let interactionCanvas!: HTMLCanvasElement;

  const waveformCache = createArrangementWaveformCache();
  let shell: ArrangementShell | null = null;
  let firstUseLogged = false;
  let editing: PlacementEditing | null = null;
  // Minted once for this component instance, like `waveformCache` above — an
  // `IdFactory` is a plain closure, not reactive state, and must persist
  // across renders rather than being rebuilt inside one.
  const ids = createIdFactory();
  // The placement drag in flight, if any: which pointer owns it, so a stray
  // move/up from another pointer is ignored.
  let activePointerId: number | null = null;

  function initialViewport(): Viewport {
    return {
      scrollLeft: 0,
      scrollTop: 0,
      width: 960,
      height: 480,
      pixelsPerTick: INITIAL_PIXELS_PER_TICK,
    };
  }

  function interactionState(): InteractionState {
    const state = shell?.getState();
    return {
      playheadTicks: state?.playheadTicks ?? null,
      selection: state?.selection ?? null,
      hoverPlacementId: state?.hoverPlacementId ?? null,
      selectedPlacementIds: new Set(editing?.getSelection() ?? []),
    };
  }

  // --- Placement editing (ARR-002) adapters ---------------------------------
  //
  // `createPlacementEditing` wants a `dispatch` with no return value and a
  // `beginGesture` returning its own `EditingGesture` shape, which differs
  // from `UseEditorSessionResult`'s `Gesture`/`dispatch` (see
  // `useEditorSession.ts`). These adapters translate without adding a second
  // mutation path: every command still flows through `props.dispatch`/
  // `props.beginGesture`, i.e. the shared command layer.

  function adaptGesture(gesture: Gesture): EditingGesture {
    return {
      apply: (commands) => {
        gesture.apply(commands);
      },
      commit: (summary) => {
        gesture.commit(summary);
      },
      cancel: () => gesture.cancel(),
    };
  }

  // The canvas lifecycle — frame scheduling, DPR sizing, per-layer dirty
  // dispatch, resize observation — lives in `useArrangementCanvas`. The shell
  // and the canvas refs are read through accessors because both are assigned
  // during render/mount, after this call.
  const canvas = useArrangementCanvas({
    shell: () => shell,
    projection: () => projection(),
    canvases: () => ({
      background: backgroundCanvas,
      content: contentCanvas,
      interaction: interactionCanvas,
    }),
    interactionState,
    waveformCache,
  });

  /** One arrangement interaction the user initiated: the once-per-account
   * `feature_first_use` for `arrangement` (PRD OPS-02). */
  function noteFirstUse(): void {
    if (firstUseLogged) return;
    firstUseLogged = analytics().logFeatureFirstUse("arrangement");
  }

  function bumpState(): void {
    setStateVersion((value) => value + 1);
  }

  /**
   * Point the editor at a track (#228). Clicking a row is how you say "this
   * one" here, exactly as clicking a strip is in the mixer; the arrangement
   * reports it and the host decides, so this surface keeps no selected-track
   * state of its own.
   */
  function selectTrack(trackId: TrackId): void {
    props.onSelectTrack?.(trackId);
    noteFirstUse();
  }

  /** The track under a viewport-local point, or null above/below the rows. */
  function trackAt(localX: number, localY: number): TrackId | null {
    if (!shell) return null;
    const { rowIndex } = shell.pointToArrangement(localX, localY);
    return projection().tracks[rowIndex]?.id ?? null;
  }

  // `onSettled` is Solid 2's lifecycle hook, and it runs before the effects
  // below get their first apply — the same order 1.x's `onMount` gave us — so
  // both still see a live shell on their first run. The refs are assigned and
  // the elements are in the document by then, which is what `observeViewport`
  // and the priming measurement need.
  onSettled(() => {
    shell = createArrangementShell(() => projection(), {
      initialViewport: initialViewport(),
      config: { maxDevicePixelRatio: 2 },
      onDirty: () => canvas.scheduleDraw(),
    });

    if (props.dispatch) {
      const dispatch = props.dispatch;
      editing = createPlacementEditing({
        getProject: () => props.project,
        dispatch: (commands) => {
          dispatch(commands);
        },
        beginGesture: (summary) => {
          const gesture = props.beginGesture?.({ summary });
          return gesture && adaptGesture(gesture);
        },
        ids,
        analytics: analytics(),
        onChange: () => {
          shell?.markDirty("interaction");
          bumpState();
        },
      });
      props.onEditingActionsReady?.(editing);
    }

    // Installed before the measurement below on purpose: a `ResizeObserver`
    // delivers the element's current size as soon as it starts observing, so
    // a viewport that is not laid out yet at this instant still reaches the
    // shell on that first delivery rather than waiting for a user resize.
    canvas.observeViewport(scrollEl, bumpState);

    // Prime the initial size and paint every layer once.
    const rect = scrollEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      shell.resize(rect.width, rect.height);
    } else {
      shell.markDirty("background", "content", "interaction");
    }
    bumpState();

    // The teardown for the registration above. In Solid 2 the value an
    // `onSettled` callback returns *is* its cleanup, which is what pairs it
    // with the setup here instead of a detached `onCleanup`.
    return () => {
      props.onEditingActionsReady?.(null);
    };
  });

  // Project identity / structure changed: everything is dirty, scroll bounds
  // re-clamp. The projection memo makes this reactive to any project change,
  // but an unrelated edit still only re-runs the cheap projection build, and a
  // no-op reconcile (same object) means the shell re-clamps to unchanged
  // bounds and redraws once. An undo/redo or remote edit can also remove a
  // selected placement out from under the controller, so it drops any
  // selected ID the project no longer contains (see `reconcile`'s doc comment).
  //
  // `projection()` is this effect's only reactive dependency, and the split is
  // load-bearing rather than stylistic: `syncSpacer` and `bumpState` both
  // write signals, which Solid 2 forbids in a tracking scope and sanctions in
  // the apply half.
  //
  // The apply half re-reads the same memo indirectly — `invalidateAll` clamps
  // scroll against the shell's own `getProjection` closure, `syncSpacer` reads
  // it for the logical size, `reconcile` reads `props.project` behind it — and
  // in dev each of those logs `STRICT_READ_UNTRACKED`. Here that diagnostic is
  // a false positive rather than a missed dependency: the compute half above
  // subscribes to exactly the memo those reads resolve, so the effect does
  // re-run and they do see the new value. Silencing it would mean either
  // `untrack` or threading the projection value through `ArrangementShell` and
  // `PlacementEditing`, neither of which belongs in a framework migration.
  createEffect(
    () => projection(),
    () => {
      shell?.invalidateAll();
      editing?.reconcile();
      syncSpacer();
      bumpState();
    },
  );

  // Transport playhead follow: seek the shell to the live position while
  // playing. `seekTo` only marks the interaction layer dirty and follows the
  // playhead into view; a stopped transport advances nothing, so the surface
  // stays idle (PRD 9.3 "must not run a permanent 60 Hz loop while stopped").
  //
  // Both the props and the accessors they hold are read in the compute half —
  // `props.playheadTicks` can be swapped for a different accessor and the
  // accessor's own value changes every transport tick, so all four reads have
  // to stay here for the playhead to keep following.
  createEffect(
    () => ({
      ticks: props.playheadTicks?.() ?? 0,
      playing: props.isPlaying?.() ?? false,
    }),
    ({ ticks, playing }) => {
      if (!shell) return;
      shell.setPlayheadFollow(playing);
      shell.seekTo(ticks);
    },
  );

  function syncSpacer(): void {
    if (!shell) return;
    const port = shell.getViewport();
    const proj = projection();
    const logicalWidth = proj.lengthTicks * port.pixelsPerTick;
    const logicalHeight =
      (proj.rowOffsets[proj.rowOffsets.length - 1] ?? 0) + RULER_HEIGHT_PX;
    if (scrollEl) {
      spacerWidth = Math.max(logicalWidth, port.width);
      spacerHeight = Math.max(logicalHeight, port.height);
      setSpacerSignal((value) => value + 1);
    }
  }

  let spacerWidth = 0;
  let spacerHeight = 0;
  const [spacerSignal, setSpacerSignal] = createSignal(0);
  const spacerStyle = createMemo(() => {
    spacerSignal();
    return { width: `${spacerWidth}px`, height: `${spacerHeight}px` };
  });

  // --- Native scroll → shell (scrollbar synchronization) --------------------
  function handleScroll(): void {
    if (!shell) return;
    shell.setScroll(scrollEl.scrollLeft, scrollEl.scrollTop);
    bumpState();
  }

  // --- Wheel: plain scroll is native; ctrl/cmd-wheel zooms anchored ---------
  function handleWheel(event: WheelEvent): void {
    if (!shell) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = scrollEl.getBoundingClientRect();
      shell.handleWheel({
        deltaX: 0,
        deltaY: event.deltaY,
        zoom: true,
        anchorX: event.clientX - rect.left,
      });
      syncSpacer();
      syncScrollElToShell();
      bumpState();
      noteFirstUse();
    }
    // Non-zoom wheel falls through to the browser's native scroll, which
    // fires `scroll` and drives the shell through `handleScroll`.
  }

  /** After a zoom (which the shell computes), push the shell's scrollLeft back
   * onto the native scroll element so its scrollbar stays synchronized. */
  function syncScrollElToShell(): void {
    if (!shell || !scrollEl) return;
    const port = shell.getViewport();
    if (scrollEl.scrollLeft !== port.scrollLeft) {
      scrollEl.scrollLeft = port.scrollLeft;
    }
    if (scrollEl.scrollTop !== port.scrollTop) {
      scrollEl.scrollTop = port.scrollTop;
    }
  }

  // --- Pointer over the interaction canvas ----------------------------------
  function localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = interactionCanvas.getBoundingClientRect();
    // The ruler occupies the top strip and does not host rows.
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top - RULER_HEIGHT_PX,
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!shell) return;
    if (editing?.isDragging() && event.pointerId === activePointerId) {
      const { x, y } = localPoint(event);
      const { tick } = shell.pointToArrangement(x, y);
      editing.updateDrag(tick);
      return;
    }
    const { x, y } = localPoint(event);
    if (y < 0) {
      shell.clearHover();
      return;
    }
    shell.handlePointerMove(x, y);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!shell) return;
    const { x, y } = localPoint(event);
    if (y < 0) return;

    // Whatever the click turns out to do — start a placement drag, select a
    // bar range — it happened on a row, and that row's track is now the one
    // being worked on (#228).
    const trackId = trackAt(x, y);
    if (trackId) selectTrack(trackId);

    // A placement hit starts a drag (move or resize) instead of the shell's
    // own bar-range selection; anything else falls through to the existing
    // behavior unchanged.
    if (editing && (event.button ?? 0) === 0) {
      const hit = shell.hitTestAt(x, y);
      if (hit.kind === "placement") {
        const { tick } = shell.pointToArrangement(x, y);
        editing.beginDrag(hit.placementId, hit.handle, tick);
        activePointerId = event.pointerId;
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        bumpState();
        noteFirstUse();
        return;
      }
    }

    const selection = shell.handlePointerDown(x, y);
    bumpState();
    if (selection) noteFirstUse();
  }

  function endActiveDrag(event: PointerEvent): void {
    if (!editing?.isDragging() || event.pointerId !== activePointerId) return;
    editing.endDrag();
    activePointerId = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
    bumpState();
  }

  // --- Named DOM actions (also the keyboard/accessibility equivalents) ------
  function zoomIn(): void {
    shell?.zoomIn();
    syncSpacer();
    syncScrollElToShell();
    bumpState();
    noteFirstUse();
  }
  function zoomOut(): void {
    shell?.zoomOut();
    syncSpacer();
    syncScrollElToShell();
    bumpState();
    noteFirstUse();
  }
  function zoomToSelection(): void {
    shell?.zoomToSelection();
    syncSpacer();
    syncScrollElToShell();
    bumpState();
    noteFirstUse();
  }
  function scrollToPlayhead(): void {
    shell?.scrollToPlayhead();
    syncScrollElToShell();
    bumpState();
    noteFirstUse();
  }

  /** Select an entire track's first bar from the accessible list, for a
   * keyboard-only user who never touches the canvas (PRD 9.3: "Keyboard
   * navigation updates selection through the same model as pointer hit
   * testing"). */
  function selectTrackFromList(rowIndex: number): void {
    if (!shell) return;
    const track = projection().tracks[rowIndex];
    if (!track) return;
    shell.setSelection({
      trackId: track.id,
      startTick: 0,
      endTick: TICKS_PER_BAR,
    });
    // The same click a pointer makes on the row: it selects the bar range
    // *and* points the editor at the track (#228).
    selectTrack(track.id);
    bumpState();
  }

  // The visible window of track rows, recomputed from the shell's row range.
  const headerRows = createMemo(() => {
    stateVersion();
    if (!shell) return [] as ArrangementProjection["tracks"][number][];
    const range = shell.rowRange();
    const tracks = projection().tracks;
    const rows: ArrangementProjection["tracks"][number][] = [];
    for (let index = range.startRow; index <= range.endRow; index += 1) {
      const track = tracks[index];
      if (track) rows.push(track);
    }
    return rows;
  });

  const scrollTopMemo = createMemo(() => {
    stateVersion();
    return shell?.getViewport().scrollTop ?? 0;
  });

  const selectionSummary = createMemo(() => {
    stateVersion();
    const selection = shell?.getState().selection;
    if (!selection) return null;
    const track = projection().tracks.find((t) => t.id === selection.trackId);
    const startBar = Math.floor(selection.startTick / TICKS_PER_BAR) + 1;
    const endBar = Math.ceil(selection.endTick / TICKS_PER_BAR) + 1;
    return { trackName: track?.name ?? "track", startBar, endBar };
  });

  /** The placement-editing selection (CLP-01), for the duplicate-mode toolbar
   * and the accessible mirror below — canvas pixels are never the sole
   * representation of which placements are selected. */
  const placementSelection = createMemo(() => {
    stateVersion();
    return editing?.getSelection() ?? [];
  });

  return (
    <div class="arrangement-view" data-testid="arrangement-view-ready">
      <ArrangementToolbar
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomToSelection={zoomToSelection}
        onScrollToPlayhead={scrollToPlayhead}
        hasSelection={selectionSummary() !== null}
      />
      <Show when={props.dispatch}>
        <PlacementToolbar
          selectionCount={placementSelection().length}
          onDuplicateLinked={() => editing?.duplicate("linked")}
          onDuplicateIndependent={() => editing?.duplicate("independent")}
        />
      </Show>
      <div class="arrangement-body">
        <div class="arrangement-headers" style={{ width: `${HEADER_WIDTH_PX}px` }}>
          <div class="arrangement-headers-ruler-spacer" />
          <ul
            class="arrangement-headers-inner"
            ref={headerListEl}
            aria-label="Tracks"
            style={{ transform: `translateY(${-scrollTopMemo()}px)` }}
          >
            <For each={headerRows()}>
              {(track) => (
                <li
                  class="arrangement-header-row"
                  style={{
                    position: "absolute",
                    top: `${track.rowIndex * ROW_METRICS.headerHeightPx}px`,
                    height: `${ROW_METRICS.headerHeightPx}px`,
                    width: "100%",
                  }}
                >
                  {/* The row is the control: clicking a track header points the
									    editor at that track (#228), and a keyboard reaches the
									    same thing by tabbing the header column. "Edit", not
									    "Select": `Select <track>` is the accessible list's name
									    for selecting that track's first bar range, below. */}
                  <button
                    type="button"
                    class="arrangement-header-select"
                    aria-pressed={props.selectedTrackId === track.id ? "true" : "false"}
                    aria-label={`Edit ${track.name}${track.muted ? " (muted)" : ""}`}
                    onClick={() => selectTrack(track.id)}
                  >
                    <span
                      class="arrangement-header-swatch"
                      style={{ background: track.color }}
                    />
                    {/* The track's name, chosen by the user. The row around it
										    stays visible, so a replay still shows which track was
										    clicked (ADR 0002 decision 2). */}
                    <span class={`arrangement-header-name ${MASK_CONTENT}`}>
                      {track.name}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
        <div
          class="arrangement-viewport"
          ref={scrollEl}
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          {/* Logical-size spacer: gives the native scroll container real,
					    browser-native scrollbars over the whole arrangement, while
					    the canvases below stay viewport-sized and sticky. */}
          <div class="arrangement-spacer" style={spacerStyle()} />
          {/* Not blocked, and — since ADR 0003 — deliberately recorded. Canvas
					    capture is on, so clip blocks, notes, waveforms, and the section
					    names drawn here all reach the payload. That is the decision, not
					    an oversight: dragging a clip edge and placing a note are the
					    interactions replay exists to show, and blocking this stack is
					    what made the arrangement a grey box. Masking does not reach
					    inside a canvas, so nothing here is half-protected — the
					    disclosure says so instead. */}
          <div class="arrangement-canvas-stack">
            <canvas class="arrangement-layer" ref={backgroundCanvas} />
            <canvas class="arrangement-layer" ref={contentCanvas} />
            <canvas
              class="arrangement-layer arrangement-layer-interactive"
              ref={interactionCanvas}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onPointerUp={endActiveDrag}
              onPointerCancel={endActiveDrag}
              onPointerLeave={(event) => {
                if (editing?.isDragging() && event.pointerId === activePointerId) {
                  return;
                }
                shell?.clearHover();
              }}
            />
          </div>
        </div>
      </div>
      {/* Accessible mirror: the visible tracks and the current selection as
			    real DOM, so assistive tech never has to read canvas pixels. Both
			    lists below are made entirely of track names — visually hidden is not
			    un-captured, so they are masked like any other name. */}
      <div class="visually-hidden">
        <p
          class={MASK_CONTENT}
          aria-live="polite"
          data-testid="arrangement-selection-live"
        >
          <Show when={selectionSummary()} fallback="No selection">
            {(summary) =>
              `Selected ${summary().trackName}, bars ${summary().startBar} to ${summary().endBar}`
            }
          </Show>
        </p>
        <ul class={MASK_CONTENT} aria-label="Arrangement tracks">
          <For each={headerRows()}>
            {(track) => (
              <li>
                <button
                  type="button"
                  data-track-select={track.id}
                  onClick={() => selectTrackFromList(track.rowIndex)}
                >
                  {`Select ${track.name}`}
                </button>
              </li>
            )}
          </For>
        </ul>
        {/* The placement-editing selection (ARR-002), as real DOM rather than
				    canvas pixels — see the module doc comment on why. */}
        <ul aria-label="Selected placements" data-testid="placement-selection">
          <For each={placementSelection()}>
            {(placementId) => <li data-selected-placement={placementId} />}
          </For>
        </ul>
      </div>
    </div>
  );
}
