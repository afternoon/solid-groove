import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import * as Tone from "tone";
import {
	type Analytics,
	analytics as defaultAnalytics,
} from "../analytics/analytics";
import { type AudioHost, getAudioRuntime } from "../audio/AudioRuntime";
import { ProjectAudioGraph } from "../audio/ProjectAudioGraph";
import type { Project } from "../domain/entities";
import { codeFor, reportError } from "../monitoring/errorReporting";
import {
	type AudioSongProjection,
	buildAudioProjection,
} from "../projection/audioProjection";

export interface ProjectAudioControls {
	readonly isPlaying: Accessor<boolean>;
	play(): Promise<void>;
	stop(): void;
	toggle(): Promise<void>;
}

export interface UseProjectAudioOptions {
	/** Defaults to the application's single `AudioRuntime`; injectable for tests. */
	readonly runtime?: AudioHost;
	readonly analytics?: Analytics;
}

/**
 * Wires one project onto the stable, ID-keyed audio graph and the single
 * shared `AudioRuntime` (`FND-009`; PRD AUD-07/AUD-08, 9.7).
 *
 * `project()` changing reconciles the existing `ProjectAudioGraph` — the
 * whole point of `FND-007`'s reconciliation is that an unrelated edit never
 * rebuilds nodes it did not touch — and only a change of project *id*
 * disposes the previous graph and opens a new scope. `play()` is the allowed
 * user gesture that resumes the runtime's context; a browser refusal (no
 * prior gesture, blocked autoplay) is reported as `audio_start_failed`
 * (PRD `OPS-02`) rather than left silent.
 */
export function useProjectAudio(
	project: Accessor<Project | null>,
	options: UseProjectAudioOptions = {},
): ProjectAudioControls {
	const runtime = options.runtime ?? getAudioRuntime();
	const analytics = options.analytics ?? defaultAnalytics;
	const [isPlaying, setIsPlaying] = createSignal(false);

	let graph: ProjectAudioGraph | null = null;
	let ownerId: string | null = null;
	let lastProjection: AudioSongProjection | undefined;

	createEffect(() => {
		const current = project();
		if (!current) return;
		if (!graph || ownerId !== current.metadata.id) {
			void graph?.dispose();
			ownerId = current.metadata.id;
			graph = new ProjectAudioGraph(runtime, ownerId);
			lastProjection = undefined;
		}
		lastProjection = buildAudioProjection(current, lastProjection);
		graph.reconcile(lastProjection);
	});

	onCleanup(() => {
		void graph?.dispose();
		graph = null;
	});

	async function play(): Promise<void> {
		try {
			// Resuming the shared context is the runtime's job; this call site is
			// the allowed user gesture that permits it (PRD AUD-07).
			await runtime.resume();
			Tone.getTransport().start();
			setIsPlaying(true);
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

	function stop(): void {
		Tone.getTransport().stop();
		setIsPlaying(false);
	}

	async function toggle(): Promise<void> {
		if (isPlaying()) {
			stop();
		} else {
			await play();
		}
	}

	return { isPlaying, play, stop, toggle };
}
