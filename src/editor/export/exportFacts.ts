import { RENDER_CHANNELS } from "../../audio/offlineRenderer";
import { songEndSeconds } from "../../audio/renderLength";
import { wav24ByteLength } from "../../audio/wavEncoder";
import type { Project } from "../../domain/entities";
import { maxStemFrames } from "../../export/stems/exportStems";
import { buildAudioProjection } from "../../projection/audioProjection";
import { projectSampleRate } from "./stereoExport";

/**
 * The facts the Export dialog's title row reads out (EXP-004): how long the
 * song is, at what tempo, how many tracks, and what the files will be
 * recorded at. Pure reads of the project, so the dialog and its tests agree.
 */

export interface ExportFacts {
  readonly name: string;
  readonly length: string;
  readonly tempo: string;
  readonly tracks: number;
  readonly quality: string;
}

/** Whole seconds as `m:ss`. Rounded once, so 59.6 s is `1:00`, never `0:60`. */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatTempo(bpm: number): string {
  return `${Number.isInteger(bpm) ? bpm : bpm.toFixed(1)} BPM`;
}

/** Every export is 24-bit; the rate is the project's own, `44.1 kHz`, `48 kHz`. */
export function formatQuality(sampleRate: number): string {
  return `24-bit · ${Number((sampleRate / 1000).toFixed(1))} kHz`;
}

export function exportFacts(project: Project): ExportFacts {
  const { song } = project;
  return {
    name: project.metadata.name,
    length: formatLength(songEndSeconds(buildAudioProjection(project))),
    tempo: formatTempo(song.tempo),
    tracks: song.tracks.length,
    quality: formatQuality(projectSampleRate(project)),
  };
}

/**
 * What the stereo WAV would weigh, before rendering: an upper bound, the song
 * plus the longest release tail it may keep, as a stem export's estimate is.
 */
export function estimateStereoBytes(project: Project): number {
  const seconds = songEndSeconds(buildAudioProjection(project));
  return wav24ByteLength(
    RENDER_CHANNELS,
    maxStemFrames(seconds, projectSampleRate(project)),
  );
}
