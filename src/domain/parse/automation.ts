import type { Song, Track } from "../entities";
import { getParameterDefinition, isParameterValueInRange } from "../parameters";
import { type DomainIssue, issue } from "./primitives";

export function checkAutomationLane(
  lane: Song["automation"][number],
  path: ReadonlyArray<string | number>,
  tracks: ReadonlyMap<string, Track>,
  returnIds: ReadonlySet<string>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const target = lane.target;

  if ("trackId" in target) {
    const track = tracks.get(target.trackId);
    if (!track) {
      issues.push(
        issue(
          "dangling_reference",
          [...path, "target", "trackId"],
          `Automation ${lane.id} targets missing track ${target.trackId}`,
        ),
      );
    } else if (target.scope === "trackDevice") {
      const device = track.devices.find((entry) => entry.id === target.deviceId);
      if (!device) {
        issues.push(
          issue(
            "dangling_reference",
            [...path, "target", "deviceId"],
            `Automation ${lane.id} targets missing device ${target.deviceId} on track ${track.id}`,
          ),
        );
      }
    } else if (target.scope === "send") {
      const send = track.sendConfig.find((entry) => entry.returnId === target.returnId);
      if (!send) {
        issues.push(
          issue(
            "dangling_reference",
            [...path, "target", "returnId"],
            `Automation ${lane.id} targets a send to ${target.returnId} that track ${track.id} does not have`,
          ),
        );
      }
    }
  }

  if (target.scope === "return" && !returnIds.has(target.returnId)) {
    issues.push(
      issue(
        "dangling_reference",
        [...path, "target", "returnId"],
        `Automation ${lane.id} targets missing return bus ${target.returnId}`,
      ),
    );
  }

  const definition = getParameterDefinition(target.parameterId);
  if (!definition) {
    issues.push(
      issue(
        "invalid_automation",
        [...path, "target", "parameterId"],
        `Automation ${lane.id} targets unknown parameter "${target.parameterId}"`,
      ),
    );
  } else if (!definition.automatable) {
    issues.push(
      issue(
        "invalid_automation",
        [...path, "target", "parameterId"],
        `Parameter "${definition.id}" does not support automation`,
      ),
    );
  }

  let previousTick = -1;
  lane.points.forEach((point, index) => {
    if (point.tick <= previousTick) {
      issues.push(
        issue(
          "invalid_automation",
          [...path, "points", index, "tick"],
          `Automation points must be ordered by strictly increasing tick, received ${point.tick} after ${previousTick}`,
        ),
      );
    }
    previousTick = point.tick;
    if (definition && !isParameterValueInRange(definition, point.value)) {
      issues.push(
        issue(
          "invalid_parameter",
          [...path, "points", index, "value"],
          `Value ${point.value} is outside the declared range ${definition.min}..${definition.max} for "${definition.id}"`,
        ),
      );
    }
  });

  return issues;
}
