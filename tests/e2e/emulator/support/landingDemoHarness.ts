import { createDevice, type DeviceTypeId } from "~/domain/devices";
import type { Clip, Device, NoteEvent, Project, Song, Track } from "~/domain/entities";
import {
  createAudioLoopClip,
  createDrumMachineInstrument,
  createDrumPad,
  createEmptySong,
  createFactoryContext,
  createNewProjectMaster,
  createNoteClip,
  createNoteEvent,
  createPlacement,
  createProjectMetadata,
  createReturnBus,
  createSection,
  createSend,
  createSynthInstrument,
  createTrack,
} from "~/domain/factories";
import { derivePackDependencies } from "~/domain/packs";
import { assertProject } from "~/domain/parse";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH, toTicks } from "~/domain/time";
import { createFactoryAsset } from "~/library/factoryLibrary";
import { getProjectRepository } from "~/projectRepositoryClient";

/**
 * The browser half of `landing.screens.spec.ts` (#1135): the demo song the
 * home page's video and stills are recorded from.
 *
 * Imported into the page through the dev server, like the export harnesses,
 * so it builds the project with the app's own factories and saves it through
 * the app's own repository as the signed-in producer. Nothing here is a mock:
 * the sounds are the factory library's, and the project is a valid schema-v1
 * project the editor opens like any other.
 *
 * Built to show the studio at work rather than a starter: four tracks of
 * different kinds (a drum machine, two synths and an audio loop), four named
 * sections over 24 bars, a device chain on the bass and chords, a reverb
 * return, and the Limiter a new master carries.
 */

const BAR = TICKS_PER_BAR;
const SIXTEENTH = TICKS_PER_SIXTEENTH;
/** The factory loop is one bar at 120 BPM, so the song sits on its own tempo. */
const TEMPO = 120;

export const DEMO_PROJECT_NAME = "Late Night Loop";

const hits = (
  context: ReturnType<typeof createFactoryContext>,
  padId: Parameters<typeof createNoteEvent>[1]["padId"],
  sixteenths: readonly number[],
  velocity = 100,
): NoteEvent[] =>
  sixteenths.map((sixteenth) =>
    createNoteEvent(context, {
      startTicks: sixteenth * SIXTEENTH,
      durationTicks: SIXTEENTH,
      padId,
      velocity,
    }),
  );

const notes = (
  context: ReturnType<typeof createFactoryContext>,
  events: readonly [sixteenth: number, length: number, pitch: number][],
): NoteEvent[] =>
  events.map(([sixteenth, length, pitch]) =>
    createNoteEvent(context, {
      startTicks: sixteenth * SIXTEENTH,
      durationTicks: length * SIXTEENTH,
      pitch,
    }),
  );

export function createLandingDemoProject(ownerId: string): Project {
  const context = createFactoryContext();
  const device = (type: DeviceTypeId, order: number): Device =>
    createDevice(context.ids("device"), type, order);

  const kick = createFactoryAsset(context, "starterKick");
  const snare = createFactoryAsset(context, "starterSnare");
  const hat = createFactoryAsset(context, "starterHat");
  const clap = createFactoryAsset(context, "starterClap");
  const loop = createFactoryAsset(context, "starterLoop");

  const verb = {
    ...createReturnBus(context, { name: "Verb", order: 0 }),
    devices: [device("reverb", 0)],
  };

  const bd = createDrumPad(context, { name: "BD", assetId: kick.id });
  const sd = createDrumPad(context, { name: "SD", assetId: snare.id });
  const hh = createDrumPad(context, { name: "HH", assetId: hat.id });
  const cp = createDrumPad(context, { name: "CP", assetId: clap.id });
  const drums = createTrack(context, {
    name: "Drums",
    order: 0,
    instrument: createDrumMachineInstrument([bd, sd, hh, cp]),
  });
  const bass = createTrack(context, {
    name: "Bass",
    order: 1,
    instrument: createSynthInstrument(),
    devices: [device("eq", 0), device("compressor", 1)],
  });
  const chords = createTrack(context, {
    name: "Chords",
    order: 2,
    instrument: createSynthInstrument(),
    devices: [device("filter", 0), device("delay", 1)],
    sendConfig: [createSend(verb.id, 0.4)],
  });
  const groove = createTrack(context, {
    name: "Groove",
    order: 3,
    type: "audio",
    instrument: null,
  });

  const clip = (track: Track, name: string, events: NoteEvent[], bars = 1): Clip =>
    createNoteClip(context, {
      trackId: track.id,
      name,
      color: track.color,
      lengthTicks: bars * BAR,
      events,
    });

  const intro = clip(drums, "Intro beat", [
    ...hits(context, bd.id, [0, 4, 8, 12]),
    ...hits(context, hh.id, [2, 6, 10, 14], 80),
  ]);
  const main = clip(drums, "Main beat", [
    ...hits(context, bd.id, [0, 4, 8, 12]),
    ...hits(context, sd.id, [4, 12]),
    ...hits(context, cp.id, [12], 70),
    ...hits(context, hh.id, [2, 6, 10, 14], 85),
    ...hits(context, hh.id, [1, 5, 9, 13], 45),
  ]);
  const bassline = clip(
    bass,
    "Bassline",
    notes(context, [
      [0, 3, 36],
      [3, 1, 36],
      [6, 2, 39],
      [10, 2, 41],
      [14, 2, 43],
      [16, 3, 34],
      [19, 1, 34],
      [22, 2, 36],
      [26, 2, 39],
      [30, 2, 41],
    ]),
    2,
  );
  const stabs = clip(
    chords,
    "Stabs",
    notes(
      context,
      [
        [0, 60],
        [16, 58],
      ].flatMap(([start, root]) =>
        [0, 3, 7, 10].map((interval) => [start, 12, root + interval] as const),
      ) as [number, number, number][],
    ),
    2,
  );
  const grooveClip = createAudioLoopClip(context, {
    trackId: groove.id,
    assetId: loop.id,
    name: "Club groove",
    color: groove.color,
    lengthTicks: BAR,
    sourceTempo: TEMPO,
  });

  const place = (target: Clip, startBar: number, bars: number) =>
    createPlacement(context, {
      clipId: target.id,
      trackId: target.trackId,
      startTicks: startBar * BAR,
      durationTicks: bars * BAR,
      looped: true,
    });

  const song: Song = {
    ...createEmptySong(TEMPO),
    master: createNewProjectMaster(context),
    // The loop brace over the first half of the Drop, where every track plays.
    loop: { startTicks: toTicks(12 * BAR), endTicks: toTicks(16 * BAR), enabled: true },
    tracks: [drums, bass, chords, groove],
    returns: [verb],
    sections: [
      createSection(context, { name: "Intro", startTicks: 0, durationTicks: 4 * BAR }),
      createSection(context, {
        name: "Verse",
        startTicks: 4 * BAR,
        durationTicks: 8 * BAR,
      }),
      createSection(context, {
        name: "Drop",
        startTicks: 12 * BAR,
        durationTicks: 8 * BAR,
      }),
      createSection(context, {
        name: "Outro",
        startTicks: 20 * BAR,
        durationTicks: 4 * BAR,
      }),
    ],
    placements: [
      place(intro, 0, 4),
      place(main, 4, 16),
      place(intro, 20, 4),
      place(bassline, 4, 16),
      place(stabs, 0, 8),
      place(stabs, 12, 12),
      place(grooveClip, 12, 8),
    ],
    assets: [kick, snare, hat, clap, loop],
  };

  return assertProject({
    metadata: createProjectMetadata(context, {
      ownerId,
      name: DEMO_PROJECT_NAME,
      template: "blank",
      packDependencies: derivePackDependencies(song),
    }),
    song,
    clips: [intro, main, bassline, stabs, grooveClip],
  });
}

/** Saves the demo song as `ownerId`'s and returns its ID. */
export async function seedLandingDemoProject(ownerId: string): Promise<string> {
  const project = createLandingDemoProject(ownerId);
  const repository = await getProjectRepository();
  const result = await repository.createProject(project);
  if (!result.ok)
    throw new Error(`createProject failed: ${result.reason} — ${result.message}`);
  return project.metadata.id;
}
