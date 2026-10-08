import { describe, expect, it } from "vitest";
import { createReferenceProject } from "../domain/fixtures";
import { type AssistantStreamEvent, createAssistantClient } from "./assistantClient";
import {
  createEmulatorAssistantProvider,
  EMULATOR_REPLY_CHUNKS,
} from "./emulatorProvider";
import type { AssistantCaller } from "./gateway";
import { createInMemoryGuardStores } from "./inMemoryGuardStores";
import { createLocalAssistantTransport } from "./localTransport";
import { buildAssistantPayload } from "./payload";

function client(caller: AssistantCaller = { uid: "u1", signInProvider: "google.com" }) {
  const guards = createInMemoryGuardStores();
  return {
    guards,
    client: createAssistantClient(
      createLocalAssistantTransport(
        {
          provider: createEmulatorAssistantProvider(),
          guards,
          log: () => {},
          now: () => 1_000,
          sleep: async () => {},
        },
        caller,
      ),
    ),
  };
}

function send(target: ReturnType<typeof client>["client"], text: string) {
  const project = createReferenceProject();
  const events: AssistantStreamEvent[] = [];
  const handle = target.send(
    {
      projectRevision: project.metadata.revision,
      messages: [{ role: "user", text }],
      context: buildAssistantPayload(project),
    },
    (event) => events.push(event),
  );
  const terminal = () => events.find((e) => e.type === "done" || e.type === "error");
  return { events, handle, terminal };
}

describe("the in-page gateway transport", () => {
  it("streams the gateway's reply through the client", async () => {
    const turn = send(client().client, "Hello");
    await expect.poll(turn.terminal, { timeout: 3_000 }).toBeDefined();
    const text = turn.events.flatMap((event) =>
      event.type === "text" ? [event.text] : [],
    );
    expect(text).toEqual([...EMULATOR_REPLY_CHUNKS]);
    expect(turn.terminal()).toMatchObject({ type: "done", stopped: false });
  });

  it("carries the gateway's error code across", async () => {
    const { client: target, guards } = client();
    guards.setEnabled(false);
    const turn = send(target, "Hello");
    await expect.poll(turn.terminal).toBeDefined();
    expect(turn.terminal()).toEqual({
      type: "error",
      error: { code: "assistant_disabled", retryable: false },
    });
  });

  it("refuses a guest", async () => {
    const turn = send(client({ uid: "g", signInProvider: "anonymous" }).client, "Hi");
    await expect.poll(turn.terminal).toBeDefined();
    expect(turn.terminal()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("stops a hanging reply", async () => {
    const turn = send(client().client, "Go on [hang]");
    await expect.poll(() => turn.events.length).toBe(1);
    turn.handle.stop();
    expect(turn.terminal()).toMatchObject({ type: "done", stopped: true });
  });
});
