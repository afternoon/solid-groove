import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import { bucketOf } from "../analytics/buckets";
import type {
	Gesture,
	GestureOptions,
	NoteChanges,
	RawCommandInput,
} from "../commands";
import {
	addNotes,
	duplicateNotes,
	removeNotes,
	updateNotes,
} from "../commands";
import type { Clip, NoteEvent, Project } from "../domain/entities";
import { createFactoryContext, createNoteEvent } from "../domain/factories";
import type { EventId } from "../domain/ids";
import { NOTE_VELOCITY } from "../domain/parameters";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH, toTicks } from "../domain/time";
import {
	clientXToTick,
	clientYToPitch,
	MAX_PITCH,
	MIN_PITCH,
	noteIntersectsRect,
	noteRect,
	type PianoRollViewport,
	pitchToContentY,
	snapTicks,
	snapTicksFloor,
	tickToContentX,
} from "./pianoRollGeometry";
import {
	isBlackKey,
	isPitchInKey,
	type KeyGuide,
	PITCH_CLASS_NAMES,
	type PitchClass,
	pitchLabel,
	type ScaleMode,
} from "./pitchClass";
import "./PianoRoll.css";

/** Mints event IDs for notes the roll creates. Module singleton (see StepGrid). */
const factoryContext = createFactoryContext();

/** Default pixel scale. Kept modest so a bar fits without horizontal scroll. */
const DEFAULT_PIXELS_PER_TICK = 0.25;
const DEFAULT_ROW_HEIGHT = 14;
/** Pitches shown, high to low: two octaves above and below middle C. */
const HIGHEST_PITCH = 96; // C7
const LOWEST_PITCH = 36; // C2
/** Notes created by a click are one 16th long by default. */
const DEFAULT_NOTE_TICKS = TICKS_PER_SIXTEENTH;
/** How wide (px) the draggable right-edge resize handle is. */
const RESIZE_HANDLE_PX = 6;

/**
 * The keyboard-driven operations the roll exposes to its host surface, so the
 * KEY-01 shortcut registry (not the roll) owns key handling. `hasSelection` is a
 * reactive accessor an `isEnabled()` can read.
 */
export interface PianoRollActions {
	deleteSelection(): void;
	duplicateSelection(): void;
	selectAll(): void;
	hasSelection(): boolean;
}

export interface PianoRollProps {
	readonly clip: Clip;
	dispatch(commands: RawCommandInput | readonly RawCommandInput[]): unknown;
	/**
	 * Called once with the roll's keyboard operations, for the host to wire into
	 * the shortcut registry (`edit.delete`, `edit.duplicate`, `edit.select_all`).
	 */
	registerActions?(actions: PianoRollActions): void;
	/** Opens a continuous gesture so a drag is one undo entry / one revision. */
	beginGesture(options?: GestureOptions): Gesture | undefined;
	/** The current project, needed to build the `notes.duplicate` payload. */
	readonly project: Project;
	/** Optional playhead position (ticks) for a playback-follow indicator. */
	readonly playheadTicks?: number;
	/** Optional in-key guide; when set, out-of-key rows are shaded. */
	readonly keyGuide?: KeyGuide | null;
	/** Defaults to the application's singleton; injectable for tests. */
	readonly analytics?: Analytics;
	/** Test seam: overrides the measured content-left, in client px. */
	readonly contentLeftForTest?: number;
	/** Test seam: overrides the measured content-top, in client px. */
	readonly contentTopForTest?: number;
}

interface DragState {
	readonly kind: "move" | "resize";
	readonly gesture: Gesture;
	/** Notes being edited, captured at gesture start. */
	readonly originals: readonly NoteEvent[];
	readonly pointerStartX: number;
	readonly pointerStartY: number;
	/** Whether any command has been applied yet (for the empty-commit case). */
	moved: boolean;
}

interface MarqueeState {
	readonly startX: number;
	readonly startY: number;
	x: number;
	y: number;
}

interface VelocityGestureState {
	readonly gesture: Gesture;
	readonly noteId: EventId;
	/** Whether any value has actually been applied yet. */
	moved: boolean;
}

function noteEvents(clip: Clip): readonly NoteEvent[] {
	return clip.content.kind === "notes" ? clip.content.events : [];
}

function pitchOf(note: NoteEvent): number {
	return note.trigger.kind === "pitch" ? note.trigger.pitch : 60;
}

/**
 * The CLP-03 piano roll: create, move, resize, group-select, duplicate,
 * delete, and set velocity on a synth clip's pitched notes, with 16th-note
 * snap and an optional in-key pitch guide.
 *
 * Every mutation goes through the shared command layer — `note.add`,
 * `note.update`, `note.remove`, `notes.duplicate` — never a direct project
 * mutation (PRD section 9.6). A continuous drag (move or resize) is one undo
 * transaction: it opens a gesture, applies each frame immediately so the UI
 * stays live, and commits once on pointer-up (PRD section 8). Pixel <-> tick /
 * pitch geometry lives in the pure `pianoRollGeometry` module so it stays
 * correct under scroll and zoom.
 */
export default function PianoRoll(props: PianoRollProps): JSX.Element {
	const analytics = () => props.analytics ?? defaultAnalytics;
	const [pixelsPerTick, setPixelsPerTick] = createSignal(
		DEFAULT_PIXELS_PER_TICK,
	);
	const rowHeight = () => DEFAULT_ROW_HEIGHT;
	const [selection, setSelection] = createSignal<ReadonlySet<EventId>>(
		new Set(),
	);
	const [drag, setDrag] = createSignal<DragState | null>(null);
	const [marquee, setMarquee] = createSignal<MarqueeState | null>(null);
	// A velocity slider drag: one gesture spans the whole drag so it commits as a
	// single undo entry / revision / clip_edited event (mirrors the move/resize
	// path). Held in a plain variable — it is transient drag bookkeeping the
	// render never reads.
	let velocityDrag: VelocityGestureState | null = null;

	// The in-key guide is view-only UI state — never persisted, never gating
	// which notes may be created (PRD CLP-03 "optional in-key pitch guide").
	const [keyGuideEnabled, setKeyGuideEnabled] = createSignal(
		props.keyGuide != null,
	);
	const [keyRoot, setKeyRoot] = createSignal<PitchClass>(
		props.keyGuide?.root ?? 0,
	);
	const [keyMode, setKeyMode] = createSignal<ScaleMode>(
		props.keyGuide?.mode ?? "major",
	);
	const activeKeyGuide = createMemo<KeyGuide | null>(() =>
		keyGuideEnabled() ? { root: keyRoot(), mode: keyMode() } : null,
	);

	let contentEl: HTMLDivElement | undefined;

	const pitches = Array.from(
		{ length: HIGHEST_PITCH - LOWEST_PITCH + 1 },
		(_, index) => HIGHEST_PITCH - index,
	);

	// The scrollable body moves the content element in client space, so a live
	// `getBoundingClientRect()` already folds in the scroll offset. Geometry
	// therefore runs with a zero scroll offset and the moving element origin —
	// the pure functions keep their scroll parameters for their own tests, but
	// the component does not need to mirror the DOM scroll into a signal.
	const viewport = createMemo<PianoRollViewport>(() => ({
		pixelsPerTick: pixelsPerTick(),
		rowHeight: rowHeight(),
		scrollTicks: 0,
		scrollTop: 0,
		topPitch: HIGHEST_PITCH,
	}));

	const contentWidth = createMemo(
		() => tickToContentX(viewport(), props.clip.lengthTicks) || 1,
	);
	const contentHeight = createMemo(() => pitches.length * rowHeight());

	function contentLeft(): number {
		if (props.contentLeftForTest !== undefined) return props.contentLeftForTest;
		return contentEl?.getBoundingClientRect().left ?? 0;
	}
	function contentTop(): number {
		if (props.contentTopForTest !== undefined) return props.contentTopForTest;
		return contentEl?.getBoundingClientRect().top ?? 0;
	}

	/** Marks the piano roll as reached, once per account per browser. */
	function markFeatureUse(): void {
		analytics().logFeatureFirstUse("piano_roll");
	}

	/** Emits `clip_edited` for one completed gesture (PRD OPS-02). */
	function logClipEdited(eventCount: number): void {
		analytics().log("clip_edited", {
			editor: "piano_roll",
			event_count_bucket: bucketOf("event_count", eventCount),
		});
	}

	function selectedIds(): readonly EventId[] {
		return [...selection()];
	}

	function isSelected(note: NoteEvent): boolean {
		return selection().has(note.id);
	}

	function selectOnly(id: EventId): void {
		setSelection(new Set([id]));
	}

	function toggleSelected(id: EventId): void {
		setSelection((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// --- Create ------------------------------------------------------------

	function createNoteAt(clientX: number, clientY: number): void {
		const view = viewport();
		const startTicks = snapTicksFloor(
			clientXToTick(view, contentLeft(), clientX),
		);
		if (startTicks >= props.clip.lengthTicks) return;
		const pitch = clientYToPitch(view, contentTop(), clientY);
		const durationTicks = Math.min(
			DEFAULT_NOTE_TICKS,
			props.clip.lengthTicks - startTicks,
		);
		const note = createNoteEvent(factoryContext, {
			startTicks,
			durationTicks,
			pitch,
		});
		markFeatureUse();
		props.dispatch(addNotes(props.clip.id, [note]));
		logClipEdited(1);
		selectOnly(note.id);
	}

	// --- Move / resize drag ------------------------------------------------

	function beginDrag(
		kind: "move" | "resize",
		note: NoteEvent,
		event: PointerEvent,
	): void {
		event.preventDefault();
		event.stopPropagation();
		markFeatureUse();
		// A drag on an unselected note selects just it; a drag on a selected note
		// keeps the whole selection so a group moves together.
		if (!isSelected(note)) selectOnly(note.id);
		const ids = new Set(isSelected(note) ? selection() : [note.id]);
		const originals = noteEvents(props.clip).filter((candidate) =>
			ids.has(candidate.id),
		);
		const gesture = props.beginGesture({
			summary: kind === "move" ? "Move notes" : "Resize notes",
		});
		if (!gesture) return;
		setDrag({
			kind,
			gesture,
			originals,
			pointerStartX: event.clientX,
			pointerStartY: event.clientY,
			moved: false,
		});
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
	}

	function updateDrag(event: PointerEvent): void {
		const state = drag();
		if (!state) return;
		const view = viewport();
		const deltaTicks =
			(event.clientX - state.pointerStartX) / view.pixelsPerTick;
		const updates =
			state.kind === "move"
				? moveUpdates(state, event, view, deltaTicks)
				: resizeUpdates(state, deltaTicks);
		state.gesture.apply(updateNotes(props.clip.id, updates));
		state.moved = true;
	}

	function moveUpdates(
		state: DragState,
		event: PointerEvent,
		view: PianoRollViewport,
		deltaTicks: number,
	): { eventId: EventId; changes: NoteChanges }[] {
		const pitchDelta = Math.round(
			(state.pointerStartY - event.clientY) / view.rowHeight,
		);
		return state.originals.map((original) => ({
			eventId: original.id,
			changes: {
				startTicks: toTicks(
					clampStart(
						snapTicks(original.startTicks + deltaTicks),
						original.durationTicks,
					),
				),
				trigger: {
					kind: "pitch" as const,
					pitch: clampPitch(pitchOf(original) + pitchDelta),
				},
			},
		}));
	}

	function resizeUpdates(
		state: DragState,
		deltaTicks: number,
	): { eventId: EventId; changes: NoteChanges }[] {
		return state.originals.map((original) => {
			const snapped = Math.max(
				TICKS_PER_SIXTEENTH,
				snapTicks(original.durationTicks + deltaTicks),
			);
			const maxDuration = props.clip.lengthTicks - original.startTicks;
			return {
				eventId: original.id,
				changes: {
					durationTicks: toTicks(
						Math.max(TICKS_PER_SIXTEENTH, Math.min(snapped, maxDuration)),
					),
				},
			};
		});
	}

	/** Keeps a moved note inside the clip: start >= 0, and it never spills past the end. */
	function clampStart(startTicks: number, durationTicks: number): number {
		const maxStart = Math.max(0, props.clip.lengthTicks - durationTicks);
		return Math.min(Math.max(0, startTicks), maxStart);
	}

	function endDrag(): void {
		const state = drag();
		if (!state) return;
		setDrag(null);
		if (state.moved) {
			state.gesture.commit();
			logClipEdited(state.originals.length);
		} else {
			state.gesture.cancel();
		}
	}

	// --- Marquee group-select ---------------------------------------------

	/** Pointer position in content-space pixels (the live element rect origin). */
	function contentPoint(event: PointerEvent): { x: number; y: number } {
		return {
			x: event.clientX - contentLeft(),
			y: event.clientY - contentTop(),
		};
	}

	function beginMarquee(event: PointerEvent): void {
		const { x, y } = contentPoint(event);
		setMarquee({ startX: x, startY: y, x, y });
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
	}

	function updateMarquee(event: PointerEvent): void {
		const state = marquee();
		if (!state) return;
		const { x, y } = contentPoint(event);
		setMarquee({ ...state, x, y });
		const rect = {
			left: Math.min(state.startX, x),
			right: Math.max(state.startX, x),
			top: Math.min(state.startY, y),
			bottom: Math.max(state.startY, y),
		};
		const view = viewport();
		const swept = new Set<EventId>();
		for (const note of noteEvents(props.clip)) {
			if (
				noteIntersectsRect(
					view,
					{
						startTicks: note.startTicks,
						durationTicks: note.durationTicks,
						pitch: pitchOf(note),
					},
					rect,
				)
			) {
				swept.add(note.id);
			}
		}
		setSelection(swept);
	}

	function endMarquee(): void {
		if (marquee()) markFeatureUse();
		setMarquee(null);
	}

	// --- Duplicate / delete / velocity ------------------------------------

	function duplicateSelection(): void {
		const ids = selectedIds();
		if (ids.length === 0) return;
		markFeatureUse();
		const command = duplicateNotes(factoryContext.ids, props.project, {
			clipId: props.clip.id,
			eventIds: ids,
			offsetTicks: TICKS_PER_BAR,
		});
		props.dispatch(command);
		logClipEdited(command.payload.newIds.length);
		setSelection(new Set(command.payload.newIds));
	}

	function deleteSelection(): void {
		const ids = selectedIds();
		if (ids.length === 0) return;
		markFeatureUse();
		props.dispatch(removeNotes(props.clip.id, ids));
		logClipEdited(ids.length);
		setSelection(new Set<EventId>());
	}

	/**
	 * Applies one intermediate velocity value from a slider drag. A range slider
	 * fires `input` continuously while the thumb moves, so the whole drag must be
	 * one gesture — otherwise a single velocity change would be many revisions,
	 * many undo entries, and many `clip_edited` events. The first `input` opens
	 * the gesture; each subsequent one applies live without bumping the revision;
	 * `commitVelocity` (on `change` / pointer-up) commits the single entry.
	 */
	function applyVelocity(note: NoteEvent, velocity: number): void {
		if (!Number.isFinite(velocity)) return;
		// A slider swap between notes mid-drag: commit the prior one first.
		if (velocityDrag && velocityDrag.noteId !== note.id) commitVelocity();
		if (!velocityDrag) {
			markFeatureUse();
			const gesture = props.beginGesture({ summary: "Set velocity" });
			if (!gesture) {
				// No history available: fall back to a single committed update.
				props.dispatch(
					updateNotes(props.clip.id, [
						{ eventId: note.id, changes: { velocity } },
					]),
				);
				logClipEdited(1);
				return;
			}
			velocityDrag = { gesture, noteId: note.id, moved: false };
		}
		velocityDrag.gesture.apply(
			updateNotes(props.clip.id, [{ eventId: note.id, changes: { velocity } }]),
		);
		velocityDrag.moved = true;
	}

	/** Commits the open velocity gesture as one entry, or cancels an empty one. */
	function commitVelocity(): void {
		const state = velocityDrag;
		if (!state) return;
		velocityDrag = null;
		if (state.moved) {
			state.gesture.commit();
			logClipEdited(1);
		} else {
			state.gesture.cancel();
		}
	}

	function selectAll(): void {
		setSelection(new Set(noteEvents(props.clip).map((note) => note.id)));
	}

	// --- Keyboard actions ---------------------------------------------------
	//
	// The roll never listens for keys itself (PRD KEY-01): the shortcut registry
	// owns `edit.delete`, `edit.duplicate`, and `edit.select_all`, and the
	// surface that hosts the roll (EditorView) installs one window controller and
	// supplies these operations as its handlers. The roll exposes them, plus a
	// reactive "has selection" for the handlers' `isEnabled`, and nothing more.
	props.registerActions?.({
		deleteSelection,
		duplicateSelection,
		selectAll,
		hasSelection: () => selection().size > 0,
	});

	// --- Render helpers ----------------------------------------------------

	function noteStyle(note: NoteEvent): JSX.CSSProperties {
		const rect = noteRect(viewport(), {
			startTicks: note.startTicks,
			durationTicks: note.durationTicks,
			pitch: pitchOf(note),
		});
		return {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		};
	}

	function rowStyle(pitch: number): JSX.CSSProperties {
		return {
			top: `${pitchToContentY(viewport(), pitch)}px`,
			height: `${rowHeight()}px`,
		};
	}

	const marqueeStyle = createMemo<JSX.CSSProperties | null>(() => {
		const state = marquee();
		if (!state) return null;
		return {
			left: `${Math.min(state.startX, state.x)}px`,
			top: `${Math.min(state.startY, state.y)}px`,
			width: `${Math.abs(state.x - state.startX)}px`,
			height: `${Math.abs(state.y - state.startY)}px`,
		};
	});

	const playheadX = createMemo(() => {
		if (props.playheadTicks === undefined) return null;
		return tickToContentX(viewport(), props.playheadTicks);
	});

	function zoomIn(): void {
		setPixelsPerTick((current) => Math.min(current * 1.5, 4));
	}
	function zoomOut(): void {
		setPixelsPerTick((current) => Math.max(current / 1.5, 0.05));
	}

	/** Whether a pitch row should be shaded as out of the active key. */
	function outOfKey(pitch: number): boolean {
		const guide = activeKeyGuide();
		return guide ? !isPitchInKey(guide, pitch) : false;
	}

	return (
		<section class="piano-roll" aria-label={`Piano roll: ${props.clip.name}`}>
			<div class="piano-roll-toolbar">
				<button
					type="button"
					class="pr-tool"
					onClick={duplicateSelection}
					disabled={selection().size === 0}
					aria-label="Duplicate selected notes"
					title="Duplicate (Ctrl/Cmd+D)"
				>
					Duplicate
				</button>
				<button
					type="button"
					class="pr-tool"
					onClick={deleteSelection}
					disabled={selection().size === 0}
					aria-label="Delete selected notes"
					title="Delete (Del)"
				>
					Delete
				</button>
				<span class="pr-selection-count" aria-live="polite">
					{selection().size} selected
				</span>
				<label class="pr-key-guide">
					<input
						type="checkbox"
						checked={keyGuideEnabled()}
						onChange={(event) =>
							setKeyGuideEnabled(event.currentTarget.checked)
						}
					/>
					<span>In-key guide</span>
				</label>
				<Show when={keyGuideEnabled()}>
					<label class="visually-hidden" for="pr-key-root">
						Key root
					</label>
					<select
						id="pr-key-root"
						class="pr-key-select"
						value={String(keyRoot())}
						onChange={(event) =>
							setKeyRoot(Number(event.currentTarget.value) as PitchClass)
						}
					>
						<For each={PITCH_CLASS_NAMES}>
							{(name, index) => <option value={String(index())}>{name}</option>}
						</For>
					</select>
					<label class="visually-hidden" for="pr-key-mode">
						Key mode
					</label>
					<select
						id="pr-key-mode"
						class="pr-key-select"
						value={keyMode()}
						onChange={(event) =>
							setKeyMode(event.currentTarget.value as ScaleMode)
						}
					>
						<option value="major">Major</option>
						<option value="minor">Minor</option>
					</select>
				</Show>
				<span class="pr-zoom">
					<button
						type="button"
						class="pr-tool"
						onClick={zoomOut}
						aria-label="Zoom out"
						title="Zoom out"
					>
						−
					</button>
					<button
						type="button"
						class="pr-tool"
						onClick={zoomIn}
						aria-label="Zoom in"
						title="Zoom in"
					>
						+
					</button>
				</span>
			</div>

			<div class="piano-roll-body">
				<div class="piano-roll-keys" style={{ height: `${contentHeight()}px` }}>
					<For each={pitches}>
						{(pitch) => (
							<div
								class="pr-key"
								classList={{
									black: isBlackKey(pitch),
									"out-of-key": outOfKey(pitch),
								}}
								style={rowStyle(pitch)}
							>
								<span class="pr-key-label">{pitchLabel(pitch)}</span>
							</div>
						)}
					</For>
				</div>

				<div
					class="piano-roll-content"
					ref={contentEl}
					style={{
						width: `${contentWidth()}px`,
						height: `${contentHeight()}px`,
					}}
					onPointerDown={(event) => {
						// A press on the empty grid either creates a note (plain) or
						// starts a marquee (shift). A press on a note is handled by the
						// note's own handler, which stops propagation.
						if ((event.button ?? 0) !== 0) return;
						if (event.shiftKey) {
							beginMarquee(event);
						} else {
							createNoteAt(event.clientX, event.clientY);
						}
					}}
					onPointerMove={(event) => {
						if (drag()) updateDrag(event);
						else if (marquee()) updateMarquee(event);
					}}
					onPointerUp={() => {
						if (drag()) endDrag();
						else if (marquee()) endMarquee();
					}}
					onPointerCancel={() => {
						if (drag()) {
							drag()?.gesture.cancel();
							setDrag(null);
						}
						setMarquee(null);
					}}
				>
					<For each={pitches}>
						{(pitch) => (
							<div
								class="pr-row"
								classList={{
									black: isBlackKey(pitch),
									"out-of-key": outOfKey(pitch),
								}}
								style={rowStyle(pitch)}
								aria-hidden="true"
							/>
						)}
					</For>

					<For each={noteEvents(props.clip)}>
						{(note) => (
							<div
								class="pr-note"
								classList={{ selected: isSelected(note) }}
								style={noteStyle(note)}
								data-event-id={note.id}
								title={`Note ${pitchLabel(pitchOf(note))}`}
								onPointerDown={(event) => {
									if ((event.button ?? 0) !== 0) return;
									if (event.shiftKey) {
										event.stopPropagation();
										toggleSelected(note.id);
										return;
									}
									const rect = (
										event.currentTarget as HTMLElement
									).getBoundingClientRect();
									const nearRightEdge =
										event.clientX >= rect.right - RESIZE_HANDLE_PX;
									beginDrag(nearRightEdge ? "resize" : "move", note, event);
								}}
								onPointerMove={(event) => {
									if (drag()) updateDrag(event);
								}}
								onPointerUp={() => {
									if (drag()) endDrag();
								}}
							>
								<span class="pr-note-resize" aria-hidden="true" />
								<input
									class="pr-note-velocity"
									type="range"
									min={NOTE_VELOCITY.min}
									max={NOTE_VELOCITY.max}
									step={0.01}
									value={note.velocity}
									aria-label={`Velocity of ${pitchLabel(pitchOf(note))}`}
									onPointerDown={(event) => event.stopPropagation()}
									onInput={(event) =>
										applyVelocity(note, event.currentTarget.valueAsNumber)
									}
									// `change` fires once the drag (or keyboard nudge) settles;
									// pointer-up/cancel cover the mouse path. All commit the one
									// open gesture — extra calls are a safe no-op.
									onChange={() => commitVelocity()}
									onPointerUp={() => commitVelocity()}
									onPointerCancel={() => commitVelocity()}
								/>
							</div>
						)}
					</For>

					<Show when={marqueeStyle()}>
						{(style) => (
							<div class="pr-marquee" style={style()} aria-hidden="true" />
						)}
					</Show>
					<Show when={playheadX() !== null}>
						<div
							class="pr-playhead"
							style={{ left: `${playheadX()}px` }}
							aria-hidden="true"
						/>
					</Show>
				</div>
			</div>
		</section>
	);
}

function clampPitch(pitch: number): number {
	if (pitch < MIN_PITCH) return MIN_PITCH;
	if (pitch > MAX_PITCH) return MAX_PITCH;
	return pitch;
}
