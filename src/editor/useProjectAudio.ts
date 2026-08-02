import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import * as Tone from "tone";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import { type AudioHost, getAudioRuntime } from "../audio/AudioRuntime";
import { ProjectAudioGraph } from "../audio/ProjectAudioGraph";
import {
	type LoopRange,
	liveTransportEngine,
	TransportController,
	TransportMetronome,
} from "../audio/Transport";
import { UnderrunMonitor } from "../audio/underrun";
import type { Project } from "../domain/entities";
import { TICKS_PER_BAR } from "../domain/time";
import { codeFor, reportError } from "../monitoring/errorReporting";
import {
	type AudioSongProjection,
	buildAudioProjection,
} from "../projection/audioProjection";

export interface ProjectAudioControls {
	readonly isPlaying: Accessor<boolean>;
	/** The playhead position in ticks, updated per animation frame while playing. */
	readonly positionTicks: Accessor<number>;
	readonly loopEnabled: Accessor<boolean>;
	readonly loop: Accessor<LoopRange | null>;
	readonly metronomeEnabled: Accessor<boolean>;
	play(): Promise<void>;
	pause(): void;
	stop(): void;
	toggle(): Promise<void>;
	seekTicks(ticks: number): void;
	/** Mirror the song's tempo (already written by a command) onto the transport. */
	setTempo(bpm: number): void;
	setLoop(startTicks: number, endTicks: number): void;
	toggleLoop(): void;
	toggleMetronome(): void;
}

export interface UseProjectAudioOptions {
	/** Defaults to the application's single `AudioRuntime`; injectable for tests. */
	readonly runtime?: AudioHost;
	readonly analytics?: Analytics;
	/** Surface the play originated from, for `transport_play` (PRD OPS-02). */
	readonly surface?: "editor" | "dashboard" | "landing";
	/** Overrides the animation-frame scheduler used to advance the playhead. */
	readonly requestFrame?: (callback: () => void) => number;
	readonly cancelFrame?: (handle: number) => void;
}

/**
 * True until the first play of the analytics session, across projects. Module
 * scope (not per-hook) so opening a second project in the same tab does not
 * reset `is_first_play_in_session` (PRD OPS-02).
 */
let firstPlayInSession = true;

/** Test-only: reset the session-first-play flag between tests. */
export function __resetFirstPlayInSessionForTests(): void {
	firstPlayInSession = true;
}

/**
 * Wires one project onto the stable, ID-keyed audio graph, the single shared
 * `AudioRuntime`, and the transport (PRD AUD-01..AUD-04, AUD-07/AUD-08).
 *
 * `project()` changing reconciles the existing `ProjectAudioGraph` — an
 * unrelated edit never rebuilds nodes it did not touch — and only a change of
 * project *id* disposes the previous graph and opens a new scope. The song's
 * tempo is mirrored onto the transport on every reconcile, so a tempo command
 * re-times the schedule without restarting the song (PRD AUD-02).
 *
 * `play()` is the allowed user gesture that resumes the runtime's context and
 * emits `transport_play`; a browser refusal is reported as `audio_start_failed`
 * (PRD OPS-02). The playhead follows via animation frames, but every audible
 * event is scheduled ahead of time by the graph, and late dispatches are
 * sampled into `audio_underrun` — playback emits nothing per scheduled event or
 * per frame (PRD AUD-03/OPS-02).
 */
export function useProjectAudio(
	project: Accessor<Project | null>,
	options: UseProjectAudioOptions = {},
): ProjectAudioControls {
	const runtime = options.runtime ?? getAudioRuntime();
	const analytics = options.analytics ?? defaultAnalytics;
	const requestFrame =
		options.requestFrame ??
		((callback) =>
			typeof requestAnimationFrame === "function"
				? requestAnimationFrame(() => callback())
				: (setTimeout(callback, 16) as unknown as number));
	const cancelFrame =
		options.cancelFrame ??
		((handle) => {
			if (typeof cancelAnimationFrame === "function")
				cancelAnimationFrame(handle);
			else clearTimeout(handle);
		});

	const [isPlaying, setIsPlaying] = createSignal(false);
	const [positionTicks, setPositionTicks] = createSignal(0);
	const [loopEnabled, setLoopEnabled] = createSignal(false);
	const [loop, setLoop] = createSignal<LoopRange | null>(null);
	const [metronomeEnabled, setMetronomeEnabled] = createSignal(false);

	let graph: ProjectAudioGraph | null = null;
	let transport: TransportController | null = null;
	let metronome: TransportMetronome | null = null;
	let ownerId: string | null = null;
	let lastProjection: AudioSongProjection | undefined;
	let frameHandle: number | null = null;

	function underrunMonitor(): UnderrunMonitor {
		return new UnderrunMonitor({
			contextSampleRate: Tone.getContext().sampleRate,
			emit: (report) => {
				analytics.log("audio_underrun", {
					dropped_event_bucket: report.droppedEventBucket,
					sample_rate: report.sampleRate,
				});
			},
		});
	}

	function tearDown(): void {
		stopFrameLoop();
		metronome?.dispose();
		metronome = null;
		transport = null;
		void graph?.dispose();
		graph = null;
	}

	createEffect(() => {
		const current = project();
		if (!current) return;
		if (!graph || ownerId !== current.metadata.id) {
			tearDown();
			ownerId = current.metadata.id;
			graph = new ProjectAudioGraph(runtime, ownerId, {
				underrunMonitor: underrunMonitor(),
			});
			metronome = new TransportMetronome(
				liveTransportEngine,
				graph.projectScope,
				graph.masterInput,
			);
			transport = new TransportController({ metronome });
			// A fresh project defaults to a one-bar loop at the start; enabling it
			// is a user gesture, but the range is ready so the first toggle needs no
			// separate selection step.
			transport.setLoop(0, TICKS_PER_BAR);
			setLoop(transport.loop);
			setLoopEnabled(false);
			setMetronomeEnabled(false);
			lastProjection = undefined;
		}
		lastProjection = buildAudioProjection(current, lastProjection);
		graph.reconcile(lastProjection);
		// Mirror the song tempo onto the transport without restarting it.
		transport?.setTempo(current.song.tempo);
	});

	onCleanup(tearDown);

	function startFrameLoop(): void {
		if (frameHandle !== null) return;
		const tick = (): void => {
			if (!transport) return;
			setPositionTicks(transport.positionTicks);
			if (transport.isPlaying) {
				frameHandle = requestFrame(tick);
			} else {
				frameHandle = null;
			}
		};
		frameHandle = requestFrame(tick);
	}

	function stopFrameLoop(): void {
		if (frameHandle !== null) {
			cancelFrame(frameHandle);
			frameHandle = null;
		}
	}

	async function play(): Promise<void> {
		try {
			// Resuming the shared context is the runtime's job; this call site is
			// the allowed user gesture that permits it (PRD AUD-07).
			await runtime.resume();
			transport?.play();
			analytics.log("transport_play", {
				is_first_play_in_session: firstPlayInSession,
			});
			firstPlayInSession = false;
			setIsPlaying(true);
			startFrameLoop();
		} catch (error) {
			const code = codeFor(error);
			analytics.log("audio_start_failed", {
				error_code: code,
				was_browser_blocked: code === "autoplay_blocked",
			});
			reportError(error, { area: "audio", fatal: false, code });
			setIsPlaying(false);
		}
	}

	function pause(): void {
		transport?.pause();
		setIsPlaying(false);
		stopFrameLoop();
	}

	function stop(): void {
		transport?.stop();
		setIsPlaying(false);
		stopFrameLoop();
		setPositionTicks(transport?.positionTicks ?? 0);
	}

	async function toggle(): Promise<void> {
		if (isPlaying()) {
			stop();
		} else {
			await play();
		}
	}

	function seekTicks(ticks: number): void {
		transport?.seekTicks(ticks);
		setPositionTicks(transport?.positionTicks ?? 0);
	}

	function setTempo(bpm: number): void {
		transport?.setTempo(bpm);
	}

	function setLoopRange(startTicks: number, endTicks: number): void {
		const range = transport?.setLoop(startTicks, endTicks);
		if (range) setLoop(range);
	}

	function toggleLoop(): void {
		transport?.toggleLoop();
		setLoopEnabled(transport?.loopEnabled ?? false);
	}

	function toggleMetronome(): void {
		transport?.toggleMetronome();
		setMetronomeEnabled(transport?.metronomeEnabled ?? false);
	}

	return {
		isPlaying,
		positionTicks,
		loopEnabled,
		loop,
		metronomeEnabled,
		play,
		pause,
		stop,
		toggle,
		seekTicks,
		setTempo,
		setLoop: setLoopRange,
		toggleLoop,
		toggleMetronome,
	};
}
