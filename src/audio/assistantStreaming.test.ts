import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type AssistantStreamEvent,
  createAssistantClient,
} from "../assistant/assistantClient";
import { createEmulatorAssistantProvider } from "../assistant/emulatorProvider";
import { createInMemoryGuardStores } from "../assistant/inMemoryGuardStores";
import { createLocalAssistantTransport } from "../assistant/localTransport";
import { buildAssistantPayload } from "../assistant/payload";
import { createSliceFixtureProject } from "../domain/fixtures";
import { buildAudioProjection } from "../projection/audioProjection";
import type { AudioTransport } from "./ProjectAudioGraph";
import { installWebAudioGlobals } from "./testAudioContext";
import { UnderrunMonitor } from "./underrun";

installWebAudioGlobals();

/**
 * A reply streaming in while the song plays (GRV-26): the conversation never
 * touches the audio graph, so nothing is rescheduled, and the event loop it
 * shares with the scheduler stays free enough that no event is dispatched
 * late, so `audio_underrun` does not rise.
 */

let AudioRuntimeModule: typeof import("./AudioRuntime");
let ProjectAudioGraphModule: typeof import("./ProjectAudioGraph");

beforeAll(async () => {
  AudioRuntimeModule = await import("./AudioRuntime");
  ProjectAudioGraphModule = await import("./ProjectAudioGraph");
});

afterEach(async () => {
  try {
    await AudioRuntimeModule.getAudioRuntime().close();
  } catch {
    // already closed
  }
  AudioRuntimeModule.__resetAudioRuntimeForTests();
});

function recordingTransport(): AudioTransport & {
  scheduled: Map<number, number>;
  callbacks: Map<number, (time: number) => void>;
  cleared: number[];
} {
  let nextId = 1;
  const scheduled = new Map<number, number>();
  const callbacks = new Map<number, (time: number) => void>();
  const cleared: number[] = [];
  return {
    bpm: { value: 120 },
    scheduled,
    callbacks,
    cleared,
    schedule(callback, time) {
      const id = nextId++;
      scheduled.set(id, Number(time));
      callbacks.set(id, callback);
      return id;
    },
    clear(id) {
      cleared.push(id);
      scheduled.delete(id);
      callbacks.delete(id);
    },
  };
}

describe("an assistant reply streaming during playback", () => {
  it("reschedules nothing and makes no dispatch late", async () => {
    const project = createSliceFixtureProject();
    const transport = recordingTransport();
    const runtime = new AudioRuntimeModule.AudioRuntime();
    const reports: unknown[] = [];
    const monitor = new UnderrunMonitor({
      contextSampleRate: 48_000,
      samplingRate: 1,
      emit: (report) => reports.push(report),
    });
    // The audio clock, kept to the wall clock: a null output device (the
    // test host's) runs the real one far faster than real time, and lateness
    // here is about the event loop the reply shares with the scheduler.
    const startedAt = performance.now();
    const clock = () => (performance.now() - startedAt) / 1_000;
    const graph = new ProjectAudioGraphModule.ProjectAudioGraph(runtime, "p", {
      transport,
      underrunMonitor: monitor,
      now: clock,
    });
    graph.reconcile(buildAudioProjection(project));
    const scheduledBefore = new Map(transport.scheduled);
    const callbacks = [...transport.callbacks.values()];
    expect(callbacks.length).toBeGreaterThan(0);

    const client = createAssistantClient(
      createLocalAssistantTransport(
        {
          provider: createEmulatorAssistantProvider(),
          guards: createInMemoryGuardStores(),
          log: () => {},
          now: Date.now,
        },
        { uid: "u1", signInProvider: "google.com" },
      ),
    );
    const events: AssistantStreamEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      client.send(
        {
          projectRevision: project.metadata.revision,
          messages: [{ role: "user", text: "Make it groove" }],
          context: buildAssistantPayload(project),
        },
        (event) => {
          events.push(event);
          if (event.type === "done" || event.type === "error") resolve();
        },
      );
    });

    // The scheduler's dispatches while the reply streams, each due one
    // lookahead after its slot on the audio clock: a loop stalled past that
    // makes it late.
    const start = clock();
    const lookAhead = 0.1;
    const step = 0.025;
    const dispatches = Array.from(
      { length: 16 },
      (_, index) =>
        new Promise<void>((resolve) =>
          setTimeout(
            () => {
              callbacks[index % callbacks.length]?.(start + index * step + lookAhead);
              resolve();
            },
            index * step * 1_000,
          ),
        ),
    );
    await Promise.all([finished, ...dispatches]);

    expect(events.at(-1)).toMatchObject({ type: "done", stopped: false });
    expect(events.filter((event) => event.type === "text").length).toBeGreaterThan(1);
    expect(reports).toEqual([]);
    expect(transport.scheduled).toEqual(scheduledBefore);
    expect(transport.cleared).toEqual([]);

    await graph.dispose();
    await runtime.close();
  });
});
