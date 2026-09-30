import type { Project } from "../../domain/entities";
import type { ReturnId, TrackId } from "../../domain/ids";
import {
  type AudioReturnProjection,
  type AudioSongProjection,
  type AudioTrackProjection,
  buildAudioProjection,
} from "../../projection/audioProjection";

/**
 * What a stem export renders, and what each file is called (EXP-003).
 *
 * A pure function of the project: it decides the files, their names and order,
 * and the audio projection each one is rendered from, and renders nothing.
 * Every stem shares the reference mix's tempo, arrangement and bar-1 origin,
 * so once the renders are padded to one length they line up sample for sample
 * in another DAW.
 *
 * - A **track stem** is that track alone: its source, inserts, fader and pan,
 *   into a master with no devices at unity gain. Its sends are left out,
 *   because what they feed is the return's own stem. Automation is deferred:
 *   the offline renderer does not play it until ARR-004 (#62), so a stem
 *   carries the static fader value. Its lanes ride along here for then.
 * - A **return stem** is that return alone, fed by every track's send to it,
 *   with every track's direct output silenced (`tracksSendOnly`).
 * - The **reference mix** is the whole song as it plays, master processing
 *   and mute/solo included — the stereo export.
 *
 * Mute and solo shape the reference mix only. Every track and return gets a
 * stem whatever its mute/solo state, and sounds in it as if unmuted: a stem
 * export is a handoff of the material, and a muted part left silent (or
 * missing) would be lost in the receiving DAW rather than merely muted there.
 *
 * A **track selection** narrows the export (a product-owner decision on #66,
 * so a project too big to export whole still exports in parts): only the
 * selected tracks get stems, every return is fed by the selected tracks' sends
 * alone, and the reference mix is the selected tracks as they play.
 *
 * Master processing is excluded from stems, but the master's transparent
 * safety limiter stays, as it does in every render (`MASTER_LIMITER_THRESHOLD_DB`,
 * `DEC-004`): it never touches material under -0.5 dBFS.
 */

export type StemKind = "track" | "return" | "mix";

export interface StemRender {
  readonly kind: StemKind;
  /** The file's path inside the archive, e.g. `03 Bass.wav`. */
  readonly path: string;
  /** The track or return it isolates; absent for the reference mix. */
  readonly sourceId?: TrackId | ReturnId;
  /** The display name, for the manifest. */
  readonly name: string;
  readonly projection: AudioSongProjection;
  /** Render with every track's direct output silenced, sends only. */
  readonly tracksSendOnly: boolean;
}

export const REFERENCE_MIX_PATH = "Reference mix.wav";
export const RETURNS_FOLDER = "Returns";

/** Characters no common file system accepts in a name, plus control codes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control codes are exactly what is stripped
const UNSAFE_FILE_CHARACTERS = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

/**
 * A name safe on every file system a DAW runs on. Numbering keeps every stem
 * distinct, so two tracks with the same name never collide.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(UNSAFE_FILE_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  return cleaned || "Untitled";
}

/**
 * Plans a stem export: every selected track in arrangement order (every track
 * when `trackIds` is absent), then every return under `Returns/` in its order,
 * then the reference mix. Paths are numbered (`01`, `02`… wide enough to sort)
 * so two tracks with one name never collide; a track keeps its number whether
 * or not the tracks before it are selected.
 */
export function planStems(
  project: Project,
  trackIds?: ReadonlySet<TrackId>,
): StemRender[] {
  const all = byOrder(project.song.tracks);
  const selected = (id: TrackId) => !trackIds || trackIds.has(id);
  const mix = onlyTracks(buildAudioProjection(project), selected);
  const returns = byOrder(project.song.returns);
  const label = (index: number, count: number, name: string) =>
    `${String(index + 1).padStart(Math.max(2, String(count).length), "0")} ${safeFileName(name)}.wav`;
  return [
    ...all.flatMap((track, index): StemRender[] =>
      !selected(track.id)
        ? []
        : [
            {
              kind: "track",
              path: label(index, all.length, track.name),
              sourceId: track.id,
              name: track.name,
              projection: isolateTrack(mix, track.id),
              tracksSendOnly: false,
            },
          ],
    ),
    ...returns.map(
      (bus, index): StemRender => ({
        kind: "return",
        path: `${RETURNS_FOLDER}/${label(index, returns.length, bus.name)}`,
        sourceId: bus.id,
        name: bus.name,
        projection: isolateReturn(mix, bus.id),
        tracksSendOnly: true,
      }),
    ),
    {
      kind: "mix",
      path: REFERENCE_MIX_PATH,
      name: "Reference mix",
      projection: mix,
      tracksSendOnly: false,
    },
  ];
}

/** The tracks a selection leaves out, in track order, for the manifest. */
export function leftOutTracks(
  project: Project,
  trackIds?: ReadonlySet<TrackId>,
): { id: TrackId; name: string }[] {
  if (!trackIds) return [];
  return byOrder(project.song.tracks)
    .filter((track) => !trackIds.has(track.id))
    .map(({ id, name }) => ({ id, name }));
}

/** The song as it plays with only the `selected` tracks in it: master
 * processing, returns and mute/solo kept. The same object when all are. */
function onlyTracks(
  mix: AudioSongProjection,
  selected: (id: TrackId) => boolean,
): AudioSongProjection {
  if (mix.tracks.every((track) => selected(track.id))) return mix;
  const tracks = mix.tracks.filter((track) => selected(track.id));
  const clips = mix.clips.filter((clip) => selected(clip.trackId));
  return {
    ...mix,
    tracks,
    tracksById: new Map(tracks.map((track) => [track.id, track])),
    clips,
    clipsById: new Map(clips.map((clip) => [clip.id, clip])),
    placements: mix.placements.filter((p) => selected(p.trackId)),
    automation: mix.automation.filter(
      ({ target }) => !("trackId" in target) || selected(target.trackId),
    ),
  };
}

/** In `order`, ties broken by id so the plan is deterministic. */
function byOrder<T extends { order: number; id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/** The master with its processing removed: no devices, unity volume. */
function bareMaster(mix: AudioSongProjection): AudioSongProjection["master"] {
  return { ...mix.master, devices: [], volume: 0 };
}

function unmuted(track: AudioTrackProjection): AudioTrackProjection {
  return { ...track, mixer: { ...track.mixer, muted: false, soloed: false } };
}

function withEntities(
  mix: AudioSongProjection,
  tracks: readonly AudioTrackProjection[],
  returns: readonly AudioReturnProjection[],
): AudioSongProjection {
  const trackIds = new Set(tracks.map((track) => track.id));
  const returnIds = new Set(returns.map((bus) => bus.id));
  const clips = mix.clips.filter((clip) => trackIds.has(clip.trackId));
  const automation = mix.automation.filter(({ target }) => {
    switch (target.scope) {
      case "master":
        return false;
      case "return":
        return returnIds.has(target.returnId);
      case "send":
        return trackIds.has(target.trackId) && returnIds.has(target.returnId);
      default:
        return trackIds.has(target.trackId);
    }
  });
  return {
    ...mix,
    master: bareMaster(mix),
    tracks,
    tracksById: new Map(tracks.map((track) => [track.id, track])),
    returns,
    returnsById: new Map(returns.map((bus) => [bus.id, bus])),
    clips,
    clipsById: new Map(clips.map((clip) => [clip.id, clip])),
    placements: mix.placements.filter((p) => trackIds.has(p.trackId)),
    automation,
  };
}

/** One track alone, without its sends, unmuted, into a bare master. */
export function isolateTrack(
  mix: AudioSongProjection,
  trackId: TrackId,
): AudioSongProjection {
  const track = mix.tracksById.get(trackId);
  if (!track) throw new RangeError(`No track ${trackId} in the projection`);
  return withEntities(mix, [{ ...unmuted(track), sendConfig: [] }], []);
}

/** One return alone, fed by every track's send to it, into a bare master. The
 * caller renders it with `tracksSendOnly` so no track's dry signal leaks in. */
export function isolateReturn(
  mix: AudioSongProjection,
  returnId: ReturnId,
): AudioSongProjection {
  const bus = mix.returnsById.get(returnId);
  if (!bus) throw new RangeError(`No return ${returnId} in the projection`);
  const tracks = mix.tracks.map((track) => ({
    ...unmuted(track),
    sendConfig: track.sendConfig.filter((send) => send.returnId === returnId),
  }));
  return withEntities(mix, tracks, [{ ...bus, mixer: { ...bus.mixer, muted: false } }]);
}
