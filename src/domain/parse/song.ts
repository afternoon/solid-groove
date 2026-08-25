import { deviceParameters } from "../devices";
import type { Device, Song, Track } from "../entities";
import {
  bareParameterId,
  getParameterDefinition,
  isParameterValueInRange,
  SAMPLER_SAMPLE_END,
  SAMPLER_SAMPLE_START,
} from "../parameters";
import { checkAutomationLane } from "./automation";
import { checkOrdering, claimId, type DomainIssue, issue } from "./primitives";

/**
 * Routing capacity ceilings (PRD FX-01, LOOP-008): "up to sixteen serial insert
 * devices per track" and "up to eight stereo send/return buses". These are the
 * numbers the PRD states and the ones every mutation path enforces, set high
 * enough that a chain or a send layout stays a creative choice rather than a
 * limit users design around. They are still finite: a bound exists so every
 * mutation path — the device/send commands and any imported document — is
 * judged against one declared value rather than a literal repeated at each call
 * site, and so a runaway document cannot grow a track's graph without end.
 *
 * Tests assert against these constants, never against a hard-coded 16 or 8, so
 * a future change to a ceiling does not silently leave a stale expectation
 * behind (see `devices.test.ts` and `parse.test.ts`).
 */
export const MAX_TRACK_INSERTS = 16;
export const MAX_RETURN_BUSES = 8;

/**
 * Song-level integrity. Callers that also hold clips pass their `seenIds` set
 * so duplicate IDs are detected across the whole aggregate.
 */
export function checkSongIntegrity(
  song: Song,
  path: ReadonlyArray<string | number>,
  seenIds: Set<string> = new Set(),
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const assetIds = new Set<string>();
  const returnIds = new Set<string>();
  const tracks = new Map<string, Track>();

  song.assets.forEach((asset, index) => {
    claimId(seenIds, asset.id, [...path, "assets", index, "id"], issues);
    assetIds.add(asset.id);
  });

  song.returns.forEach((bus, index) => {
    claimId(seenIds, bus.id, [...path, "returns", index, "id"], issues);
    returnIds.add(bus.id);
    issues.push(
      ...checkDeviceChain(bus.devices, [...path, "returns", index, "devices"], seenIds),
    );
  });
  issues.push(
    ...checkOrdering(
      song.returns.map((bus) => bus.order),
      [...path, "returns"],
      "return buses",
    ),
  );
  if (song.returns.length > MAX_RETURN_BUSES) {
    issues.push(
      issue(
        "capacity_exceeded",
        [...path, "returns"],
        `A song may have at most ${MAX_RETURN_BUSES} return buses, found ${song.returns.length}`,
      ),
    );
  }

  issues.push(
    ...checkDeviceChain(song.master.devices, [...path, "master", "devices"], seenIds),
  );

  song.tracks.forEach((track, index) => {
    const trackPath = [...path, "tracks", index] as const;
    claimId(seenIds, track.id, [...trackPath, "id"], issues);
    tracks.set(track.id, track);
    issues.push(...checkDeviceChain(track.devices, [...trackPath, "devices"], seenIds));
    if (track.devices.length > MAX_TRACK_INSERTS) {
      issues.push(
        issue(
          "capacity_exceeded",
          [...trackPath, "devices"],
          `A track may have at most ${MAX_TRACK_INSERTS} insert devices, track ${track.id} has ${track.devices.length}`,
        ),
      );
    }
    issues.push(...checkInstrument(track, trackPath, assetIds, seenIds));

    const usedReturns = new Set<string>();
    track.sendConfig.forEach((send, sendIndex) => {
      const sendPath = [...trackPath, "sendConfig", sendIndex] as const;
      if (!returnIds.has(send.returnId)) {
        issues.push(
          issue(
            "dangling_reference",
            [...sendPath, "returnId"],
            `Track ${track.id} sends to missing return bus ${send.returnId}`,
          ),
        );
      }
      if (usedReturns.has(send.returnId)) {
        issues.push(
          issue(
            "duplicate_id",
            [...sendPath, "returnId"],
            `Track ${track.id} has more than one send to return bus ${send.returnId}`,
          ),
        );
      }
      usedReturns.add(send.returnId);
    });
  });
  issues.push(
    ...checkOrdering(
      song.tracks.map((track) => track.order),
      [...path, "tracks"],
      "tracks",
    ),
  );

  song.sections.forEach((section, index) => {
    claimId(seenIds, section.id, [...path, "sections", index, "id"], issues);
  });

  song.placements.forEach((placement, index) => {
    const placementPath = [...path, "placements", index] as const;
    claimId(seenIds, placement.id, [...placementPath, "id"], issues);
    if (!tracks.has(placement.trackId)) {
      issues.push(
        issue(
          "dangling_reference",
          [...placementPath, "trackId"],
          `Placement ${placement.id} references missing track ${placement.trackId}`,
        ),
      );
    }
  });

  song.automation.forEach((lane, index) => {
    const lanePath = [...path, "automation", index] as const;
    claimId(seenIds, lane.id, [...lanePath, "id"], issues);
    issues.push(...checkAutomationLane(lane, lanePath, tracks, returnIds));
  });

  return issues;
}

function checkInstrument(
  track: Track,
  path: ReadonlyArray<string | number>,
  assetIds: ReadonlySet<string>,
  seenIds: Set<string>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const instrument = track.instrument;
  if (!instrument) {
    return issues;
  }
  // Every stored instrument parameter is validated against its registered
  // definition (invariant 10), the same way device parameters are — namespaced
  // by instrument kind, `${kind}.${parameterId}`.
  issues.push(
    ...checkInstrumentParameters(instrument.kind, instrument.parameters, [
      ...path,
      "instrument",
      "parameters",
    ]),
  );
  if (instrument.kind === "sampler") {
    if (instrument.assetId !== null && !assetIds.has(instrument.assetId)) {
      issues.push(
        issue(
          "dangling_reference",
          [...path, "instrument", "assetId"],
          `Track ${track.id} references missing asset ${instrument.assetId}`,
        ),
      );
    }
    // A sample window collapses to silence — or plays backwards — unless its
    // end is strictly after its start.
    const start = instrument.parameters[bareParameterId(SAMPLER_SAMPLE_START.id)];
    const end = instrument.parameters[bareParameterId(SAMPLER_SAMPLE_END.id)];
    if (start !== undefined && end !== undefined && end <= start) {
      issues.push(
        issue(
          "invalid_parameter",
          [...path, "instrument", "parameters", "sampleEnd"],
          `Sample end ${end} must be greater than sample start ${start}`,
        ),
      );
    }
  }
  if (instrument.kind === "drumMachine") {
    instrument.pads.forEach((pad, index) => {
      const padPath = [...path, "instrument", "pads", index] as const;
      claimId(seenIds, pad.id, [...padPath, "id"], issues);
      if (pad.assetId !== null && !assetIds.has(pad.assetId)) {
        issues.push(
          issue(
            "dangling_reference",
            [...padPath, "assetId"],
            `Drum pad ${pad.id} references missing asset ${pad.assetId}`,
          ),
        );
      }
      for (const [parameterId, value] of Object.entries(pad.parameters)) {
        const definition = getParameterDefinition(`pad.${parameterId}`);
        if (definition && !isParameterValueInRange(definition, value)) {
          issues.push(
            issue(
              "invalid_parameter",
              [...padPath, "parameters", parameterId],
              `Value ${value} is outside the declared range ${definition.min}..${definition.max}`,
            ),
          );
        }
      }
    });
  }
  return issues;
}

/** Validates a sparse instrument parameter map against its registered definitions. */
function checkInstrumentParameters(
  kind: NonNullable<Track["instrument"]>["kind"],
  parameters: Readonly<Record<string, number>>,
  path: ReadonlyArray<string | number>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  for (const [parameterId, value] of Object.entries(parameters)) {
    const definition = getParameterDefinition(`${kind}.${parameterId}`);
    if (definition && !isParameterValueInRange(definition, value)) {
      issues.push(
        issue(
          "invalid_parameter",
          [...path, parameterId],
          `Value ${value} is outside the declared range ${definition.min}..${definition.max}`,
        ),
      );
    }
  }
  return issues;
}

function checkDeviceChain(
  devices: readonly Device[],
  path: ReadonlyArray<string | number>,
  seenIds: Set<string>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  devices.forEach((device, index) => {
    claimId(seenIds, device.id, [...path, index, "id"], issues);
    // A registered device type owns a known parameter set; an unregistered
    // type (forward-compatible passthrough, LOOP-009) declares none, so its
    // stored parameters are accepted as opaque finite numbers.
    const declared = new Set(
      deviceParameters(device.type).map((definition) => bareParameterId(definition.id)),
    );
    const typeIsRegistered = declared.size > 0;
    for (const [parameterId, value] of Object.entries(device.parameters)) {
      if (typeIsRegistered && !declared.has(parameterId)) {
        issues.push(
          issue(
            "invalid_parameter",
            [...path, index, "parameters", parameterId],
            `Device type "${device.type}" has no parameter "${parameterId}"`,
          ),
        );
        continue;
      }
      const definition = getParameterDefinition(`${device.type}.${parameterId}`);
      if (definition && !isParameterValueInRange(definition, value)) {
        issues.push(
          issue(
            "invalid_parameter",
            [...path, index, "parameters", parameterId],
            `Value ${value} is outside the declared range ${definition.min}..${definition.max}`,
          ),
        );
      }
    }
  });
  issues.push(
    ...checkOrdering(
      devices.map((device) => device.order),
      path,
      "devices",
    ),
  );
  return issues;
}
