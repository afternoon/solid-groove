import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../domain/entities";
import { type ControlAddress, controlKey, MASTER_ENTITY } from "./controlAddress";
import { controlsTouchedBy } from "./controls";
import { COMMAND_TYPES, requireCommand } from "./registry";
import { ABSENT_IDS, createCommandTestProject } from "./testProjects";
import type { RawCommandInput } from "./types";

/**
 * `controlsTouchedBy` is a contract (`UI-004`, #850): AI-004's proposal card,
 * its dashed preview and its solid "applied" outline all read it. So the
 * address every registered command lands on is pinned here, one example per
 * command, rather than derived from the code it checks. A new command fails
 * "covers every registered command" until it is given a row.
 */

const fixture = createCommandTestProject();
const { project } = fixture;
const trackA = project.song.tracks[0];
const trackB = project.song.tracks[1];
const clipA = project.clips[0];
const placementA = project.song.placements[0];
const [kickId, clapId] = fixture.padIds;
const kick =
  trackB.instrument?.kind === "drumMachine" ? trackB.instrument.pads[0] : undefined;
const device = trackA.devices[0];
const returnBus = project.song.returns[0];
const asset = project.song.assets[0];
const [drumsPack] = fixture.packs;
const firstEvent =
  clipA.content.kind === "notes" ? (clipA.content.events[0] as NoteEvent) : undefined;
const eventId = fixture.eventIds[0];
const insert = { chain: "insert", trackId: fixture.trackAId } as const;

const at = (entity: string, param: string): ControlAddress => ({ entity, param });

interface Row {
  readonly command: RawCommandInput;
  readonly touches: readonly ControlAddress[];
}

const ROWS: Readonly<Record<string, Row>> = {
  // --- Notes and clip content: the clip's notes ----------------------------
  "note.add": {
    command: { type: "note.add", payload: { clipId: clipA.id, notes: [firstEvent] } },
    touches: [at(clipA.id, "notes")],
  },
  "note.remove": {
    command: { type: "note.remove", payload: { clipId: clipA.id, eventIds: [eventId] } },
    touches: [at(clipA.id, "notes")],
  },
  "note.update": {
    command: {
      type: "note.update",
      payload: { clipId: clipA.id, updates: [{ eventId, changes: { velocity: 0.4 } }] },
    },
    touches: [at(clipA.id, "notes")],
  },
  "notes.transpose": {
    command: {
      type: "notes.transpose",
      payload: { clipId: clipA.id, eventIds: null, semitones: 2 },
    },
    touches: [at(clipA.id, "notes")],
  },
  "notes.scaleVelocity": {
    command: {
      type: "notes.scaleVelocity",
      payload: { clipId: clipA.id, eventIds: null, factor: 0.5 },
    },
    touches: [at(clipA.id, "notes")],
  },
  "notes.quantize": {
    command: {
      type: "notes.quantize",
      payload: { clipId: clipA.id, eventIds: null, gridTicks: 48, strength: 1 },
    },
    touches: [at(clipA.id, "notes")],
  },
  "notes.duplicate": {
    command: {
      type: "notes.duplicate",
      payload: {
        clipId: clipA.id,
        eventIds: [eventId],
        offsetTicks: 48,
        newIds: [ABSENT_IDS.event],
      },
    },
    touches: [at(clipA.id, "notes")],
  },
  "notes.clear": {
    command: { type: "notes.clear", payload: { clipId: clipA.id } },
    touches: [at(clipA.id, "notes")],
  },
  "notes.vary": {
    command: {
      type: "notes.vary",
      payload: {
        clipId: clipA.id,
        eventIds: null,
        seed: "seed",
        amount: 0.5,
        gridTicks: 48,
      },
    },
    touches: [at(clipA.id, "notes")],
  },
  "notes.quantizeToScale": {
    command: {
      type: "notes.quantizeToScale",
      payload: { clipId: clipA.id, eventIds: null },
    },
    touches: [at(clipA.id, "notes")],
  },

  // --- Clips ---------------------------------------------------------------
  "clip.create": {
    command: { type: "clip.create", payload: { clip: clipA } },
    touches: [at(clipA.id, "notes")],
  },
  "clip.delete": {
    command: { type: "clip.delete", payload: { clipId: clipA.id } },
    touches: [at(trackA.id, "arrangement")],
  },
  "clip.update": {
    command: {
      type: "clip.update",
      payload: { clipId: clipA.id, changes: { name: "Riff", lengthTicks: 1536 } },
    },
    touches: [at(clipA.id, "name"), at(clipA.id, "length")],
  },

  // --- Tracks --------------------------------------------------------------
  "track.create": {
    command: { type: "track.create", payload: { track: trackA } },
    touches: [at(trackA.id, "header")],
  },
  "track.delete": {
    command: { type: "track.delete", payload: { trackId: trackA.id } },
    touches: [at("song", "tracks")],
  },
  "track.update": {
    command: {
      type: "track.update",
      payload: { trackId: trackA.id, changes: { name: "Lead" } },
    },
    touches: [at(trackA.id, "header")],
  },
  "track.reorder": {
    command: { type: "track.reorder", payload: { trackId: trackA.id, toIndex: 1 } },
    touches: [at(trackA.id, "header")],
  },
  "track.setFlag": {
    command: {
      type: "track.setFlag",
      payload: { trackId: trackA.id, flag: "muted", value: true },
    },
    touches: [at(trackA.id, "muted")],
  },

  // --- Placements: the clip on the arrangement ----------------------------
  "placement.create": {
    command: { type: "placement.create", payload: { placement: placementA } },
    touches: [at(placementA.id, "placement")],
  },
  "placement.delete": {
    command: { type: "placement.delete", payload: { placementId: placementA.id } },
    touches: [at(trackA.id, "arrangement")],
  },
  "placement.update": {
    command: {
      type: "placement.update",
      payload: { placementId: placementA.id, changes: { startTicks: 768 } },
    },
    touches: [at(placementA.id, "placement")],
  },

  // --- Parameters: the owning entity plus the bare parameter key ----------
  "parameter.set": {
    command: {
      type: "parameter.set",
      payload: {
        target: { scope: "track", trackId: trackA.id, parameterId: "track.volume" },
        value: -6,
      },
    },
    touches: [at(trackA.id, "volume")],
  },

  // --- Drum pads -----------------------------------------------------------
  "drum.setPadAsset": {
    command: {
      type: "drum.setPadAsset",
      payload: { trackId: trackB.id, padId: kickId, assetId: null },
    },
    touches: [at(kickId, "sample")],
  },
  "drum.renamePad": {
    command: {
      type: "drum.renamePad",
      payload: { trackId: trackB.id, padId: kickId, name: "Kick" },
    },
    touches: [at(kickId, "name")],
  },
  "drum.setPadFlag": {
    command: {
      type: "drum.setPadFlag",
      payload: { trackId: trackB.id, padId: kickId, flag: "soloed", value: true },
    },
    touches: [at(kickId, "soloed")],
  },
  "drum.setPadChoke": {
    command: {
      type: "drum.setPadChoke",
      payload: { trackId: trackB.id, padId: kickId, chokeGroup: 1 },
    },
    touches: [at(kickId, "choke")],
  },
  "drum.setPadParameter": {
    command: {
      type: "drum.setPadParameter",
      payload: { trackId: trackB.id, padId: kickId, parameterId: "pad.pitch", value: 3 },
    },
    touches: [at(kickId, "pitch")],
  },
  "drum.addPad": {
    command: { type: "drum.addPad", payload: { trackId: trackB.id, pad: kick } },
    touches: [at(kickId, "lane")],
  },
  "drum.removePad": {
    command: { type: "drum.removePad", payload: { trackId: trackB.id, padId: clapId } },
    touches: [at(trackB.id, "pads")],
  },
  "drum.reorderPad": {
    command: {
      type: "drum.reorderPad",
      payload: { trackId: trackB.id, padId: clapId, toIndex: 0 },
    },
    touches: [at(clapId, "lane")],
  },

  // --- Instruments ---------------------------------------------------------
  "instrument.change": {
    command: {
      type: "instrument.change",
      payload: { trackId: trackA.id, instrument: { kind: "synth", parameters: {} } },
    },
    touches: [at(trackA.id, "instrument")],
  },
  "instrument.setSample": {
    command: {
      type: "instrument.setSample",
      payload: { trackId: trackA.id, assetId: null },
    },
    touches: [at(trackA.id, "sample")],
  },

  // --- Packs and assets: library bookkeeping, addressed on the song -------
  "pack.add": {
    command: {
      type: "pack.add",
      payload: { pack: { packId: drumsPack.id, version: drumsPack.version } },
    },
    touches: [at("song", "packs")],
  },
  "pack.remove": {
    command: {
      type: "pack.remove",
      payload: { pack: { packId: drumsPack.id, version: drumsPack.version } },
    },
    touches: [at("song", "packs")],
  },
  "pack.setVersion": {
    command: {
      type: "pack.setVersion",
      payload: { packId: drumsPack.id, from: drumsPack.version, to: "9.9.9" },
    },
    touches: [at("song", "packs")],
  },
  "asset.add": {
    command: { type: "asset.add", payload: { asset } },
    touches: [at("song", "assets")],
  },
  "asset.remove": {
    command: { type: "asset.remove", payload: { assetId: asset.id } },
    touches: [at("song", "assets")],
  },

  // --- Devices: the faceplate, or the chain a removed one was in ----------
  "device.add": {
    command: { type: "device.add", payload: { target: insert, device } },
    touches: [at(device.id, "faceplate")],
  },
  "device.remove": {
    command: { type: "device.remove", payload: { target: insert, deviceId: device.id } },
    touches: [at(trackA.id, "devices")],
  },
  "device.reorder": {
    command: {
      type: "device.reorder",
      payload: { target: insert, deviceId: device.id, toIndex: 1 },
    },
    touches: [at(device.id, "faceplate")],
  },
  "device.duplicate": {
    command: {
      type: "device.duplicate",
      payload: { target: insert, deviceId: device.id, newDeviceId: ABSENT_IDS.device },
    },
    touches: [at(ABSENT_IDS.device, "faceplate")],
  },
  "device.setBypass": {
    command: {
      type: "device.setBypass",
      payload: { target: insert, deviceId: device.id, bypassed: true },
    },
    touches: [at(device.id, "bypassed")],
  },
  "device.reset": {
    command: { type: "device.reset", payload: { target: insert, deviceId: device.id } },
    touches: [at(device.id, "faceplate")],
  },
  "device.restoreParameters": {
    command: {
      type: "device.restoreParameters",
      payload: { target: insert, deviceId: device.id, parameters: { time: 0.5 } },
    },
    touches: [at(device.id, "faceplate")],
  },

  // --- Returns and sends (#386): the strip, or the list a removed one was in -
  "return.create": {
    command: {
      type: "return.create",
      payload: { returnBus: { ...returnBus, id: ABSENT_IDS.return } },
    },
    touches: [at(ABSENT_IDS.return, "header")],
  },
  "return.delete": {
    command: { type: "return.delete", payload: { returnId: returnBus.id } },
    touches: [at("song", "returns")],
  },
  "return.update": {
    command: {
      type: "return.update",
      payload: { returnId: returnBus.id, changes: { name: "Plate" } },
    },
    touches: [at(returnBus.id, "name")],
  },
  "send.add": {
    command: {
      type: "send.add",
      payload: {
        trackId: trackB.id,
        send: { returnId: returnBus.id, level: 0.5, preFader: false },
      },
    },
    touches: [at(trackB.id, `sendLevel.${returnBus.id}`)],
  },
  "send.remove": {
    command: {
      type: "send.remove",
      payload: { trackId: trackA.id, returnId: returnBus.id },
    },
    touches: [at(trackA.id, "sends")],
  },

  // --- Song ----------------------------------------------------------------
  "loop.setRange": {
    command: { type: "loop.setRange", payload: { startTicks: 0, endTicks: 768 } },
    touches: [at("song", "loop")],
  },
  "loop.setEnabled": {
    command: { type: "loop.setEnabled", payload: { enabled: true } },
    touches: [at("song", "loop")],
  },
  "key.set": {
    command: { type: "key.set", payload: { root: 0, scale: "major" } },
    touches: [at("song", "key")],
  },
  "project.rename": {
    command: { type: "project.rename", payload: { name: "New name" } },
    touches: [at("song", "name")],
  },
};

describe("controlsTouchedBy", () => {
  it("covers every registered command, and nothing else", () => {
    expect(Object.keys(ROWS).sort()).toEqual([...COMMAND_TYPES].sort());
  });

  it.each(Object.entries(ROWS))("%s touches its pinned controls", (type, row) => {
    // The example must be a payload execution would accept, or the row would
    // pin the error path rather than the address.
    expect(requireCommand(type).parsePayload(row.command.payload)).toMatchObject({
      ok: true,
    });
    expect(controlsTouchedBy(row.command, project)).toEqual(row.touches);
  });

  it("declares at least one control for every registered command", () => {
    for (const type of COMMAND_TYPES) {
      const touched = controlsTouchedBy(ROWS[type].command, project);
      expect(touched.length, `${type} declares no control`).toBeGreaterThan(0);
    }
  });

  describe("parameter.set, by scope", () => {
    const set = (target: unknown) =>
      controlsTouchedBy(
        { type: "parameter.set", payload: { target, value: 0 } },
        project,
      );

    it("addresses song tempo and swing on the song", () => {
      expect(set({ scope: "song", parameterId: "song.tempo" })).toEqual([
        at("song", "tempo"),
      ]);
      expect(set({ scope: "song", parameterId: "song.swing" })).toEqual([
        at("song", "swing"),
      ]);
    });

    it("addresses a track's pan, and an instrument's parameter, on the track", () => {
      expect(
        set({ scope: "track", trackId: trackA.id, parameterId: "track.pan" }),
      ).toEqual([at(trackA.id, "pan")]);
      expect(
        set({ scope: "instrument", trackId: trackA.id, parameterId: "pitch" }),
      ).toEqual([at(trackA.id, "pitch")]);
    });

    it("addresses a device parameter on the device, whichever chain it is in", () => {
      expect(
        set({
          scope: "trackDevice",
          trackId: trackA.id,
          deviceId: device.id,
          parameterId: "time",
        }),
      ).toEqual([at(device.id, "time")]);
      expect(
        set({ scope: "masterDevice", deviceId: ABSENT_IDS.device, parameterId: "mix" }),
      ).toEqual([at(ABSENT_IDS.device, "mix")]);
    });

    it("addresses the master, a return and a send on their own entities", () => {
      expect(set({ scope: "master", parameterId: "master.volume" })).toEqual([
        at(MASTER_ENTITY, "volume"),
      ]);
      expect(
        set({ scope: "return", returnId: fixture.returnId, parameterId: "return.pan" }),
      ).toEqual([at(fixture.returnId, "pan")]);
      expect(
        set({
          scope: "send",
          trackId: trackA.id,
          returnId: fixture.returnId,
          parameterId: "track.sendLevel",
        }),
      ).toEqual([at(trackA.id, `sendLevel.${fixture.returnId}`)]);
    });
  });

  it("addresses a master-chain removal on the master's chain", () => {
    expect(
      controlsTouchedBy(
        {
          type: "device.remove",
          payload: { target: { chain: "master" }, deviceId: device.id },
        },
        project,
      ),
    ).toEqual([at(MASTER_ENTITY, "devices")]);
  });

  it("falls back to the song's arrangement when a deleted placement is already gone", () => {
    expect(
      controlsTouchedBy(
        { type: "placement.delete", payload: { placementId: ABSENT_IDS.placement } },
        project,
      ),
    ).toEqual([at("song", "arrangement")]);
  });

  it("refuses an unregistered command or an invalid payload rather than guessing", () => {
    expect(() =>
      controlsTouchedBy({ type: "note.explode", payload: {} }, project),
    ).toThrow(/Unknown command/);
    expect(() => controlsTouchedBy({ type: "note.add", payload: {} }, project)).toThrow(
      /invalid note.add payload/,
    );
  });

  it("never reads the project for a command that does not delete", () => {
    // A proposal's lines are addressed before it is applied, against whatever
    // project is open; a changed control must not depend on it.
    const empty = { ...project, clips: [], song: { ...project.song, placements: [] } };
    for (const [type, row] of Object.entries(ROWS)) {
      if (type === "clip.delete" || type === "placement.delete") continue;
      expect(controlsTouchedBy(row.command, empty).map(controlKey)).toEqual(
        row.touches.map(controlKey),
      );
    }
  });
});
