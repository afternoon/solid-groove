/**
 * Test-only harness for `placementEditingController` (`ARR-002`): a live
 * fixture project the controller edits through a real `executeTransaction`
 * dispatch, plus a recording analytics transport and a counting gesture — so a
 * test asserts on the project the edits actually produced, not on the commands
 * they intended to produce.
 */

import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { executeTransaction } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { memoryStorage } from "../testing/storage";
import {
  createPlacementEditing,
  type EditingGesture,
} from "./placementEditingController";

export type RecordingTransport = ReturnType<typeof createRecordingTransport>;

/** Events of one catalogued name, in order. */
export function eventsNamed(transport: RecordingTransport, name: string) {
  return transport.events.filter((event) => event.name === name);
}

export function createEditingHarness(options: { analyticsAllowed?: boolean } = {}) {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const allowed = options.analyticsAllowed ?? true;
  consent.set({ productAnalytics: allowed, errorMonitoring: allowed });
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });

  let project: Project = createSliceFixtureProject();
  const gestures = { commits: 0, cancels: 0 };

  function dispatch(commands: readonly RawCommandInput[]): void {
    const result = executeTransaction(project, commands);
    if (result.ok) project = result.project;
  }

  const editing = createPlacementEditing({
    getProject: () => project,
    dispatch,
    beginGesture: (): EditingGesture => ({
      apply: (commands) => dispatch(commands),
      commit: () => {
        gestures.commits += 1;
      },
      cancel: () => {
        gestures.cancels += 1;
      },
    }),
    ids: createSeededIdFactory("controller"),
    analytics,
  });

  return {
    editing,
    transport,
    gestures,
    getProject: () => project,
    placementId: () => project.song.placements[0].id,
  };
}
