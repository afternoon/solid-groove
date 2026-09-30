import type { PackVersion } from "../domain/entities";
import type { AssetId, PackId, PadId, TrackId } from "../domain/ids";
import type {
  AudioAssetProjection,
  AudioSongProjection,
  AudioTrackProjection,
} from "./audioProjection";
import { fingerprintOf } from "./fingerprint";

/**
 * A library sound heard in place of a slot's own (LIB-010 hot-swap audition).
 * It exists only in the audio projection; the project never sees it.
 */
export interface PreviewSound {
  readonly packId: PackId;
  readonly packVersion: PackVersion;
  readonly kind: string;
  readonly storageRef: string;
  readonly url: string | null;
  readonly durationSeconds: number | null;
  readonly sampleRate: number | null;
  readonly channelCount: number | null;
}

/** One slot: a sampler track (no `padId`) or one pad of a drum machine. */
export interface PreviewSlot {
  readonly trackId: TrackId;
  readonly padId?: PadId;
}

export interface PreviewOverride {
  readonly slot: PreviewSlot;
  readonly sound: PreviewSound;
}

/** The stable identity a previewed sound loads under: the same sound is one buffer. */
export function previewAssetId(sound: PreviewSound): AssetId {
  const hash = fingerprintOf([sound.packId, sound.packVersion, sound.storageRef]);
  return `ast_preview${hash.padEnd(10, "0").slice(0, 10)}` as AssetId;
}

function previewAsset(sound: PreviewSound): AudioAssetProjection {
  return { id: previewAssetId(sound), ...sound, fingerprint: fingerprintOf(sound) };
}

function overrideTrack(
  track: AudioTrackProjection,
  padId: PadId | undefined,
  assetId: AssetId,
): AudioTrackProjection | null {
  const instrument = track.instrument;
  let swapped: AudioTrackProjection["instrument"] = null;
  if (padId === undefined && instrument?.kind === "sampler") {
    swapped = { ...instrument, assetId };
  } else if (padId !== undefined && instrument?.kind === "drumMachine") {
    if (!instrument.pads.some((pad) => pad.id === padId)) return null;
    swapped = {
      ...instrument,
      pads: instrument.pads.map((pad) => (pad.id === padId ? { ...pad, assetId } : pad)),
    };
  }
  if (!swapped) return null;
  const preview = `${assetId}:${padId ?? ""}`;
  return {
    ...track,
    instrument: swapped,
    fingerprint: fingerprintOf([track.fingerprint, preview]),
    topologyFingerprint: fingerprintOf([track.topologyFingerprint, preview]),
  };
}

/**
 * `base` with the override applied: only the named slot's asset differs, every
 * other track and pad is the same object. No override, or a slot that no
 * longer exists, returns `base` itself.
 */
export function applyPreviewOverride(
  base: AudioSongProjection,
  override: PreviewOverride | null,
): AudioSongProjection {
  if (!override) return base;
  const track = base.tracksById.get(override.slot.trackId);
  if (!track) return base;
  const asset = previewAsset(override.sound);
  const swapped = overrideTrack(track, override.slot.padId, asset.id);
  if (!swapped) return base;
  const tracks = base.tracks.map((entry) => (entry === track ? swapped : entry));
  return {
    ...base,
    tracks,
    tracksById: new Map(tracks.map((entry) => [entry.id, entry])),
    assets: [...base.assets, asset],
  };
}
