import type { Device } from "../domain/entities";
import type { ReturnId, TrackId } from "../domain/ids";
import type { AudioSongProjection } from "../projection/audioProjection";
import { deviceLatencyFrames } from "./devices";
import { masterLimiterLatencyFrames } from "./MasterAudioGraph";

/**
 * Plugin delay compensation (#883): how much each path through the mix is
 * delayed so that every one reaches the master in step with the slowest.
 *
 * A device that looks ahead (the Compressor) delays everything after it on
 * its own path. Left alone, a compressed track plays behind the others and its
 * stem drifts against theirs, so every path is delayed instead, by the
 * difference between its own latency and the slowest path's. The latencies
 * come from each device's declaration (`deviceLatencyFrames`); nothing here
 * measures anything, so this is a pure function of the projection and the
 * sample rate, shared by live playback and the offline renderer.
 *
 * The mix has two stages to line up, because a send leaves its track after
 * the track's devices and then passes through its return's:
 *
 * 1. **Tracks.** Every track is delayed, right after its device chain and
 *    before its sends tap it, to the slowest track's latency. So every send
 *    leaves every track at the same moment.
 * 2. **Returns.** Every return is delayed to the slowest return's latency,
 *    and every track's direct output to the master by that same figure, so
 *    the dry and the returned signal arrive together.
 *
 * What remains is the latency of the master itself (its devices and its
 * safety limiter), which delays the whole mix alike. Live, that is a lag
 * behind the playhead no path can be aligned against; an offline render drops
 * {@link LatencyCompensationPlan.totalFrames} from the front, so the file
 * starts at bar 1 whatever devices any chain holds.
 *
 * Every path is compensated whether or not it is muted or sends anywhere, so
 * a mute, a solo or a send edit never moves anything in time; only adding,
 * removing or retyping a lookahead device does.
 */
export interface LatencyCompensationPlan {
  /** Frames each track is delayed by after its devices, before its sends. */
  readonly tracks: ReadonlyMap<TrackId, number>;
  /** Frames every track's direct output is delayed by on its way to the
   * master, to wait for the slowest return. */
  readonly trackOutputFrames: number;
  /** Frames each return is delayed by after its devices. */
  readonly returns: ReadonlyMap<ReturnId, number>;
  /** How late every compensated path reaches the master's mix. Anything that
   * joins the master directly (the metronome) is delayed by this much too. */
  readonly mixFrames: number;
  /** The master's own latency: its devices, then the safety limiter. */
  readonly masterFrames: number;
  /** From the transport to the output: `mixFrames + masterFrames`. */
  readonly totalFrames: number;
}

/** A chain's latency: the sum of its devices'. A bypassed device still
 * counts, since bypass keeps its dry leg aligned to its wet one. */
export function chainLatencyFrames(
  devices: readonly Pick<Device, "type">[],
  sampleRate: number,
): number {
  let frames = 0;
  for (const device of devices) frames += deviceLatencyFrames(device.type, sampleRate);
  return frames;
}

/** Plans the compensation for one song at one sample rate. */
export function planLatencyCompensation(
  song: Pick<AudioSongProjection, "tracks" | "returns" | "master">,
  sampleRate: number,
): LatencyCompensationPlan {
  const trackLatency = song.tracks.map(
    (track) => [track.id, chainLatencyFrames(track.devices, sampleRate)] as const,
  );
  const returnLatency = song.returns.map(
    (bus) => [bus.id, chainLatencyFrames(bus.devices, sampleRate)] as const,
  );
  const slowestTrack = Math.max(0, ...trackLatency.map(([, frames]) => frames));
  const slowestReturn = Math.max(0, ...returnLatency.map(([, frames]) => frames));
  const mixFrames = slowestTrack + slowestReturn;
  const masterFrames =
    chainLatencyFrames(song.master.devices, sampleRate) +
    masterLimiterLatencyFrames(sampleRate);
  return {
    tracks: new Map(trackLatency.map(([id, frames]) => [id, slowestTrack - frames])),
    trackOutputFrames: slowestReturn,
    returns: new Map(returnLatency.map(([id, frames]) => [id, slowestReturn - frames])),
    mixFrames,
    masterFrames,
    totalFrames: mixFrames + masterFrames,
  };
}
