import * as Tone from "tone";
import type { DrumPad } from "../../domain/entities";
import type { PadId } from "../../domain/ids";
import { PAD_ATTACK, PAD_DECAY, PAD_PITCH } from "../../domain/parameters";
import type { AudioProjectScope } from "../AudioRuntime";
import {
  type AssetVoice,
  attachAssetVoice,
  createAssetVoice,
  dbToLinear,
  pitchToPlaybackRate,
  releaseAssetVoice,
} from "./assetVoice";
import type {
  DrumMachineInstrument,
  InstrumentGraphContext,
  InstrumentNode,
} from "./types";

/** Reads a registered pad parameter from a pad's `parameters` record, falling
 * back to the definition's default when the pad has never set it. */
function padParameterValue(
  pad: DrumPad,
  definition: { id: string; defaultValue: number },
): number {
  const key = definition.id.slice("pad.".length);
  const value = pad.parameters[key];
  return value === undefined ? definition.defaultValue : value;
}

/**
 * The stable per-pad state a drum machine keeps between triggers: the pad's
 * live buffer subscription, its persistent pan+level channel strip, its choke
 * group, and a handle to whatever short-lived voice is currently sounding (so
 * a choke can silence it).
 *
 * The channel strip persists; the sounding voice does not. Each trigger builds
 * a throwaway `Tone.Player` + envelope gain that self-disposes on stop, so
 * simultaneous hits never contend for one node and a completed hit leaves no
 * schedule or reference behind (PRD AUD-08).
 */
interface DrumPadStrip extends AssetVoice {
  /** After the envelope, before the output bus: pan then level/mute. */
  readonly panner: Tone.Panner;
  readonly level: Tone.Gain;
  chokeGroup: number | null;
  pitch: number;
  attack: number;
  decay: number;
  /** The voice currently sounding on this pad, if any. Choke stops it. */
  active: ActiveVoice | null;
}

/** One sounding hit: its player, its envelope gain, and its stop scheduler. */
interface ActiveVoice {
  readonly player: Tone.Player;
  readonly envelope: Tone.Gain;
  stopped: boolean;
}

function readPadDynamics(pad: DrumPad): {
  pitch: number;
  attack: number;
  decay: number;
} {
  return {
    pitch: padParameterValue(pad, PAD_PITCH),
    attack: padParameterValue(pad, PAD_ATTACK),
    decay: padParameterValue(pad, PAD_DECAY),
  };
}

function createDrumPadStrip(
  pad: DrumPad,
  context: InstrumentGraphContext,
  destination: Tone.ToneAudioNode,
): DrumPadStrip {
  const level = new Tone.Gain(
    dbToLinear(pad.mixer.muted ? null : pad.mixer.volume),
  ).connect(destination);
  const panner = new Tone.Panner(pad.mixer.pan).connect(level);
  const dynamics = readPadDynamics(pad);
  const strip: DrumPadStrip = {
    ...createAssetVoice(),
    panner,
    level,
    chokeGroup: pad.chokeGroup,
    active: null,
    ...dynamics,
  };
  attachAssetVoice(strip, context, pad.assetId);
  return strip;
}

/** Reconciles a pad's persistent strip against an edited pad, without rebuilding
 * it. Pitch/attack/decay take effect on the *next* hit; pan/level smooth now. */
function updateDrumPadStrip(
  strip: DrumPadStrip,
  pad: DrumPad,
  context: InstrumentGraphContext,
): void {
  if (strip.assetId !== pad.assetId) {
    attachAssetVoice(strip, context, pad.assetId);
  }
  strip.level.gain.rampTo(dbToLinear(pad.mixer.muted ? null : pad.mixer.volume), 0.02);
  strip.panner.pan.rampTo(pad.mixer.pan, 0.02);
  strip.chokeGroup = pad.chokeGroup;
  const dynamics = readPadDynamics(pad);
  strip.pitch = dynamics.pitch;
  strip.attack = dynamics.attack;
  strip.decay = dynamics.decay;
}

function stopActiveVoice(voice: ActiveVoice, time: Tone.Unit.Time): void {
  if (voice.stopped) return;
  voice.stopped = true;
  // A short release so a choke or an overlapping re-hit does not click. The
  // player disposes itself via its own `onstop`, which the stop below fires.
  const releaseSeconds = 0.005;
  voice.envelope.gain.cancelScheduledValues(Tone.Time(time).toSeconds());
  voice.envelope.gain.setValueAtTime(
    voice.envelope.gain.value,
    Tone.Time(time).toSeconds(),
  );
  voice.envelope.gain.linearRampTo(0, releaseSeconds, time);
  voice.player.stop(Tone.Time(time).toSeconds() + releaseSeconds);
}

function releasePadStrip(strip: DrumPadStrip, scope: AudioProjectScope): void {
  if (strip.active && !strip.active.stopped) {
    strip.active.stopped = true;
    try {
      strip.active.player.stop();
    } catch {
      // The player may already have stopped and disposed; disposal is idempotent.
    }
  }
  strip.active = null;
  releaseAssetVoice(strip, scope);
  strip.panner.dispose();
  strip.level.dispose();
}

export function createDrumMachineInstrumentNode(
  instrument: DrumMachineInstrument,
  context: InstrumentGraphContext,
): InstrumentNode {
  const output = new Tone.Gain(1);
  const strips = new Map<PadId, DrumPadStrip>();
  /**
   * Every pad's own mute/solo lives in the pad mixer; "solo wins if any pad is
   * soloed, and an explicit mute always wins over solo" is decided here, on the
   * current pad set, so it is correct even mid-playback after an edit.
   */
  let audiblePads = new Set<PadId>();

  function recomputeAudible(pads: readonly DrumPad[]): void {
    const anySolo = pads.some((pad) => pad.mixer.soloed);
    audiblePads = new Set(
      pads
        .filter((pad) => !pad.mixer.muted && (!anySolo || pad.mixer.soloed))
        .map((pad) => pad.id),
    );
  }

  function reconcilePads(pads: readonly DrumPad[]): void {
    const nextIds = new Set(pads.map((pad) => pad.id));
    for (const [id, strip] of strips) {
      if (!nextIds.has(id)) {
        releasePadStrip(strip, context.scope);
        strips.delete(id);
      }
    }
    for (const pad of pads) {
      const existing = strips.get(pad.id);
      if (existing) {
        updateDrumPadStrip(existing, pad, context);
      } else {
        strips.set(pad.id, createDrumPadStrip(pad, context, output));
      }
    }
    recomputeAudible(pads);
  }
  reconcilePads(instrument.pads);

  /** Stops every currently-sounding voice in `chokeGroup` other than `exceptId`. */
  function chokeGroup(group: number, exceptId: PadId, time: Tone.Unit.Time): void {
    for (const [id, strip] of strips) {
      if (id === exceptId) continue;
      if (strip.chokeGroup === group && strip.active) {
        stopActiveVoice(strip.active, time);
        strip.active = null;
      }
    }
  }

  return {
    kind: "drumMachine",
    output,
    trigger(trigger, time, duration, velocity) {
      if (trigger.kind !== "pad") return;
      const strip = strips.get(trigger.padId);
      if (!strip?.buffer) return;
      if (!audiblePads.has(trigger.padId)) return;

      // A pad in a choke group silences both any earlier voice from another
      // pad in the same group and its own still-ringing voice, so a
      // hi-hat closes an open hat and a rapid re-hit does not stack.
      if (strip.chokeGroup !== null) {
        chokeGroup(strip.chokeGroup, trigger.padId, time);
      }
      if (strip.active) {
        stopActiveVoice(strip.active, time);
        strip.active = null;
      }

      const envelope = new Tone.Gain(0).connect(strip.panner);
      const player = new Tone.Player(strip.buffer).connect(envelope);
      player.playbackRate = pitchToPlaybackRate(strip.pitch);
      const voice: ActiveVoice = { player, envelope, stopped: false };
      strip.active = voice;

      const startSeconds = Tone.Time(time).toSeconds();
      const peak = Math.max(0, Math.min(1, velocity));
      // A short-lived AD amp envelope: ramp to the velocity peak over the
      // attack, then decay to silence. `decay` bounds the tail, so a long
      // sample under a short decay is a tight hit rather than a full loop.
      envelope.gain.setValueAtTime(0, startSeconds);
      envelope.gain.linearRampToValueAtTime(
        peak,
        startSeconds + Math.max(0.0005, strip.attack),
      );
      envelope.gain.linearRampToValueAtTime(
        0,
        startSeconds + Math.max(0.0005, strip.attack) + strip.decay,
      );

      // The scheduled note duration still bounds a very long decay; whichever
      // is shorter ends the voice. The player self-disposes on stop.
      const noteSeconds = Tone.Time(duration).toSeconds();
      const voiceSeconds = Math.min(
        strip.attack + strip.decay,
        Number.isFinite(noteSeconds) && noteSeconds > 0
          ? noteSeconds
          : Number.POSITIVE_INFINITY,
      );
      player.onstop = () => {
        player.dispose();
        envelope.dispose();
        if (strip.active === voice) strip.active = null;
      };
      player.start(time, 0);
      if (Number.isFinite(voiceSeconds)) {
        player.stop(startSeconds + voiceSeconds);
      }
    },
    update(next) {
      if (next.kind !== "drumMachine") return;
      reconcilePads(next.pads);
    },
    dispose() {
      for (const strip of strips.values()) {
        releasePadStrip(strip, context.scope);
      }
      strips.clear();
      output.dispose();
    },
  };
}
