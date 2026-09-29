import { createDevice } from "../../domain/devices";
import type { AutomationLane, Project } from "../../domain/entities";
import {
  createFactoryContext,
  createNoteClip,
  createNoteEvent,
  createPlacement,
  createReturnBus,
  createSend,
  createSynthInstrument,
  createTrack,
} from "../../domain/factories";
import { createPianoRollFixtureProject } from "../../domain/fixtures";
import { createSeededIdFactory } from "../../domain/ids";
import { TICKS_PER_BAR } from "../../domain/time";

/** A stem-export test project (tests only): a soloed "Lead" with a filter and a
 * send to "Verb", a muted "Sub/Bass" sending to "Delay", a master saturator,
 * and automation on every scope. Tracks and returns are listed out of order. */
export function createStemFixtureProject(): Project {
  const base = createPianoRollFixtureProject();
  const context = createFactoryContext({ ids: createSeededIdFactory(66), now: 0 });
  const verb = createReturnBus(context, { name: "Verb", order: 0 });
  const delay = createReturnBus(context, { name: "Delay", order: 1 });
  const lead = base.song.tracks[0];
  const bass = createTrack(context, {
    name: "Sub/Bass",
    order: 1,
    instrument: createSynthInstrument(),
    muted: true,
    sendConfig: [createSend(delay.id, 0.5)],
  });
  const bassClip = createNoteClip(context, {
    trackId: bass.id,
    name: "Line",
    lengthTicks: TICKS_PER_BAR,
    events: [createNoteEvent(context, { startTicks: 0, durationTicks: 96, pitch: 36 })],
  });
  const bassPlacement = createPlacement(context, {
    clipId: bassClip.id,
    trackId: bass.id,
    startTicks: TICKS_PER_BAR * 2,
    durationTicks: TICKS_PER_BAR,
  });
  const lane = (id: string, target: AutomationLane["target"]): AutomationLane => ({
    id: id as AutomationLane["id"],
    target,
    interpolation: "linear",
    points: [],
  });
  return {
    ...base,
    song: {
      ...base.song,
      tracks: [
        bass,
        {
          ...lead,
          devices: [createDevice(context.ids("device"), "filter", 0)],
          sendConfig: [createSend(verb.id, 0.4)],
          mixer: { ...lead.mixer, soloed: true },
        },
      ],
      returns: [delay, verb],
      master: {
        ...base.song.master,
        volume: -6,
        devices: [createDevice(context.ids("device"), "saturator", 0)],
      },
      placements: [...base.song.placements, bassPlacement],
      automation: [
        lane("aut_master", { scope: "master", parameterId: "volume" }),
        lane("aut_lead", { scope: "track", trackId: lead.id, parameterId: "volume" }),
        lane("aut_bass", { scope: "track", trackId: bass.id, parameterId: "pan" }),
        lane("aut_send", {
          scope: "send",
          trackId: lead.id,
          returnId: verb.id,
          parameterId: "level",
        }),
        lane("aut_verb", { scope: "return", returnId: verb.id, parameterId: "volume" }),
      ],
    },
    clips: [...base.clips, bassClip],
  };
}
