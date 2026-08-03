import {
	HiSolidDocumentDuplicate,
	HiSolidPlus,
	HiSolidTrash,
} from "solid-icons/hi";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	Show,
} from "solid-js";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import type {
	Gesture,
	GestureOptions,
	RawCommandInput,
	TransactionResult,
} from "../commands";
import {
	addTrack,
	removeTrack,
	reorderTrack,
	setParameter,
	setTrackFlag,
	updateTrack,
} from "../commands";
import ConfirmDialog from "../components/ConfirmDialog";
import { duplicateTrack } from "../domain/duplicateTrack";
import type { Project, Track } from "../domain/entities";
import {
	createFactoryContext,
	createSynthInstrument,
	createTrack,
} from "../domain/factories";
import {
	dbToFaderPosition,
	faderPositionToDb,
	formatDb,
	formatPan,
} from "../domain/faders";
import type { TrackId } from "../domain/ids";
import { TRACK_PAN, TRACK_VOLUME } from "../domain/parameters";
import "./Mixer.css";

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
		return props.project.clips.filter((clip) => clip.trackId === trackId)
			.length;
	}

	function handleAddTrack(): void {
		const order = tracks().length;
		const track = createTrackRecord(order);
		props.dispatch(addTrack(track));
		analytics().log("track_added", { track_type: "instrument" });
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
		analytics().log("track_added", { track_type: trackTypeKey(track) });
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
			<button type="button" class="mixer-add-track" onClick={handleAddTrack}>
				<HiSolidPlus size={18} />
				<span>Add track</span>
			</button>
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
		<div class="mixer-strip" style={{ "--strip-color": props.track.color }}>
			<div class="mixer-strip-header">
				<label class="visually-hidden" for={`track-name-${props.track.id}`}>
					Track name
				</label>
				<input
					id={`track-name-${props.track.id}`}
					class="mixer-strip-name"
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

			<div class="mixer-strip-reorder">
				<button
					type="button"
					class="mixer-reorder-up"
					aria-label={`Move ${props.track.name} left`}
					disabled={props.index === 0}
					onClick={() =>
						props.dispatch(reorderTrack(props.track.id, props.index - 1))
					}
				>
					‹
				</button>
				<button
					type="button"
					class="mixer-reorder-down"
					aria-label={`Move ${props.track.name} right`}
					disabled={props.index >= props.trackCount - 1}
					onClick={() =>
						props.dispatch(reorderTrack(props.track.id, props.index + 1))
					}
				>
					›
				</button>
			</div>

			<div class="mixer-strip-flags">
				<button
					type="button"
					class="mixer-mute"
					classList={{ active: props.track.mixer.muted }}
					aria-pressed={props.track.mixer.muted}
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
					class="mixer-solo"
					classList={{ active: props.track.mixer.soloed }}
					aria-pressed={props.track.mixer.soloed}
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

			<PanControl
				track={props.track}
				value={panValue()}
				dispatch={props.dispatch}
				beginGesture={props.beginGesture}
			/>

			<div class="mixer-strip-fader-row">
				<VolumeFader
					track={props.track}
					value={volumeDb()}
					dispatch={props.dispatch}
					beginGesture={props.beginGesture}
				/>
				<LevelMeter
					trackId={props.track.id}
					trackLevelDb={props.trackLevelDb}
					isPlaying={props.isPlaying}
					requestFrame={props.requestFrame}
					cancelFrame={props.cancelFrame}
				/>
			</div>
			<span class="mixer-strip-value" aria-hidden="true">
				{formatDb(TRACK_VOLUME, volumeDb())}
			</span>

			<div class="mixer-strip-actions">
				<button
					type="button"
					class="mixer-duplicate"
					aria-label={`Duplicate ${props.track.name}`}
					onClick={() => props.onDuplicate()}
				>
					<HiSolidDocumentDuplicate size={14} />
				</button>
				<button
					type="button"
					class="mixer-delete"
					aria-label={`Delete ${props.track.name}`}
					onClick={() => props.onDelete()}
				>
					<HiSolidTrash size={14} />
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
	let gesture: Gesture | undefined;

	function target() {
		return {
			scope: "track" as const,
			trackId: props.track.id,
			parameterId: TRACK_VOLUME.id,
		};
	}

	return (
		<input
			class="mixer-fader"
			type="range"
			min={0}
			max={1}
			step={0.001}
			value={position()}
			aria-label={`Volume for ${props.track.name}`}
			aria-valuetext={formatDb(TRACK_VOLUME, props.value)}
			onPointerDown={() => {
				// One gesture per drag: every input event applies live but the whole
				// drag commits as one history entry, one revision, and one save.
				gesture = props.beginGesture({
					summary: `Set volume for ${props.track.name}`,
				});
			}}
			onInput={(event) => {
				const db = faderPositionToDb(
					TRACK_VOLUME,
					event.currentTarget.valueAsNumber,
				);
				const command = setParameter(target(), db);
				if (gesture?.active) {
					gesture.apply(command);
				} else {
					props.dispatch(command);
				}
			}}
			onPointerUp={() => {
				gesture?.commit();
				gesture = undefined;
			}}
		/>
	);
}

function PanControl(props: FaderProps): JSX.Element {
	let gesture: Gesture | undefined;

	function target() {
		return {
			scope: "track" as const,
			trackId: props.track.id,
			parameterId: TRACK_PAN.id,
		};
	}

	return (
		<div class="mixer-pan">
			<input
				class="mixer-pan-input"
				type="range"
				min={TRACK_PAN.min}
				max={TRACK_PAN.max}
				step={0.01}
				value={props.value}
				aria-label={`Pan for ${props.track.name}`}
				aria-valuetext={formatPan(props.value)}
				onPointerDown={() => {
					gesture = props.beginGesture({
						summary: `Set pan for ${props.track.name}`,
					});
				}}
				onInput={(event) => {
					const command = setParameter(
						target(),
						event.currentTarget.valueAsNumber,
					);
					if (gesture?.active) {
						gesture.apply(command);
					} else {
						props.dispatch(command);
					}
				}}
				onPointerUp={() => {
					gesture?.commit();
					gesture = undefined;
				}}
			/>
			<span class="mixer-pan-value" aria-hidden="true">
				{formatPan(props.value)}
			</span>
		</div>
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
			if (typeof cancelAnimationFrame === "function")
				cancelAnimationFrame(handle);
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
	// playback ends (see `poll`).
	createEffect(() => {
		if (props.isPlaying() && frame === null) {
			frame = requestFrame(poll);
		}
	});

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
			<div
				class="mixer-meter-fill"
				style={{ height: `${fillFraction() * 100}%` }}
			/>
		</div>
	);
}

function createTrackRecord(order: number): Track {
	return createTrack(factoryContext, {
		name: `Track ${order + 1}`,
		order,
		type: "instrument",
		instrument: createSynthInstrument(),
	});
}

function trackTypeKey(track: Track): "instrument" | "audio" {
	return track.type;
}

function deleteWarning(clips: number): string {
	const noun = clips === 1 ? "clip" : "clips";
	return `This track has ${clips} ${noun}. Deleting it removes them too. This can be undone.`;
}
