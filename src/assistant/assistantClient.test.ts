import { describe, expect, it } from "vitest";
import { MINIMAL_ASSISTANT_CONTEXT } from "../testing/scriptedAssistantProvider";
import {
  type AssistantStreamEvent,
  type AssistantTurnStream,
  type AssistantTurnTransport,
  assistantErrorFrom,
  createAssistantClient,
} from "./assistantClient";
import type { AssistantTurnRequest } from "./protocol";

const REQUEST: AssistantTurnRequest = {
  projectRevision: 3,
  messages: [{ role: "user", text: "Make it groove" }],
  context: MINIMAL_ASSISTANT_CONTEXT,
};

/** A transport whose chunks and result the test releases by hand. */
function manualTransport() {
  const pending: unknown[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let resolveResult!: (value: unknown) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<unknown>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let signal: AbortSignal | null = null;
  const stream: AssistantTurnStream = {
    chunks: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const next = pending.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
    result,
  };
  const release = () => {
    wake?.();
    wake = null;
  };
  const transport: AssistantTurnTransport = async (_request, options) => {
    signal = options.signal;
    return stream;
  };
  return {
    transport,
    signal: () => signal,
    chunk(value: unknown) {
      pending.push(value);
      release();
    },
    finish(value: unknown) {
      ended = true;
      release();
      resolveResult(value);
    },
    fail(error: unknown) {
      ended = true;
      release();
      rejectResult(error);
    },
  };
}

function record(transport: AssistantTurnTransport) {
  const events: AssistantStreamEvent[] = [];
  const handle = createAssistantClient(transport).send(REQUEST, (event) =>
    events.push(event),
  );
  return { events, handle };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const RESULT = {
  text: "Hello there",
  stopReason: "end_turn",
  proposal: null,
  model: "claude-sonnet-5",
  promptVersion: "1",
  requestsRemaining: 41,
};

describe("the assistant client", () => {
  it("streams the reply's text, then one done", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    wire.chunk({ type: "text", text: "Hello " });
    await flush();
    expect(events).toEqual([{ type: "text", text: "Hello " }]);
    wire.chunk({ type: "text", text: "there" });
    wire.finish(RESULT);
    await flush();
    expect(events).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "there" },
      { type: "done", stopped: false, stopReason: "end_turn", requestsRemaining: 41 },
    ]);
  });

  it("hands a proposal over before the done", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    const proposal = {
      baseRevision: 3,
      toolsetVersion: 2,
      calls: [{ id: "toolu_1", name: "parameter_set", input: {} }],
    };
    wire.finish({ ...RESULT, stopReason: "tool_use", proposal });
    await flush();
    expect(events.map((event) => event.type)).toEqual(["proposal", "done"]);
    expect(events[0]).toEqual({ type: "proposal", proposal });
  });

  it("hands a question for the producer over after the proposal, before the done", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    const proposal = {
      baseRevision: 3,
      toolsetVersion: 2,
      calls: [{ id: "toolu_1", name: "parameter_set", input: {} }],
    };
    const ask = {
      id: "toolu_2",
      question: "Which way?",
      options: [{ label: "Up" }, { label: "Down" }],
      multiSelect: false,
    };
    wire.finish({ ...RESULT, stopReason: "tool_use", proposal, ask });
    await flush();
    expect(events.map((event) => event.type)).toEqual(["proposal", "ask", "done"]);
    expect(events[1]).toEqual({ type: "ask", ask });
  });

  it("turns a question in the wrong shape into a malformed_response error", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    wire.finish({
      ...RESULT,
      stopReason: "tool_use",
      ask: { id: "toolu_1", question: "Which?", options: [{ label: "Only one" }] },
    });
    await flush();
    expect(events).toEqual([
      { type: "error", error: { code: "malformed_response", retryable: true } },
    ]);
  });

  it("turns a chunk in the wrong shape into one malformed_response error", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    wire.chunk({ type: "image", data: "…" });
    wire.chunk({ type: "text", text: "after" });
    wire.finish(RESULT);
    await flush();
    expect(events).toEqual([
      { type: "error", error: { code: "malformed_response", retryable: true } },
    ]);
  });

  it("turns a result in the wrong shape into a malformed_response error", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    wire.finish({ text: 4 });
    await flush();
    expect(events).toEqual([
      { type: "error", error: { code: "malformed_response", retryable: true } },
    ]);
  });

  it("reports the gateway's own code, and when a quota resets", async () => {
    const wire = manualTransport();
    const { events } = record(wire.transport);
    wire.fail({
      code: "functions/resource-exhausted",
      details: { code: "quota_exceeded", retryable: true, resetsAt: 5_000 },
    });
    await flush();
    // `retryable` is derived from the code, never taken from the wire.
    expect(events).toEqual([
      {
        type: "error",
        error: { code: "quota_exceeded", retryable: false, resetsAt: 5_000 },
      },
    ]);
  });

  it("fails as a transport that cannot even start", async () => {
    const { events } = record(async () => {
      throw { code: "functions/unauthenticated" };
    });
    await flush();
    expect(events).toEqual([
      { type: "error", error: { code: "unauthenticated", retryable: false } },
    ]);
  });

  it("stops at once, aborts the call, and reports nothing after", async () => {
    const wire = manualTransport();
    const { events, handle } = record(wire.transport);
    wire.chunk({ type: "text", text: "Hel" });
    await flush();
    handle.stop();
    expect(events.at(-1)).toEqual({
      type: "done",
      stopped: true,
      stopReason: null,
      requestsRemaining: null,
    });
    expect(wire.signal()?.aborted).toBe(true);
    wire.chunk({ type: "text", text: "lo" });
    wire.fail({ code: "functions/cancelled" });
    await flush();
    expect(events.map((event) => event.type)).toEqual(["text", "done"]);
    handle.stop();
    expect(events).toHaveLength(2);
  });
});

describe("assistantErrorFrom", () => {
  it("offers Try again for the handler's unexpected internal failure", () => {
    expect(assistantErrorFrom({ code: "functions/internal" })).toEqual({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("reads the kill switch and a timeout from their details", () => {
    expect(
      assistantErrorFrom({
        code: "functions/unavailable",
        details: { code: "assistant_disabled" },
      }),
    ).toEqual({ code: "assistant_disabled", retryable: false });
    expect(assistantErrorFrom({ code: "functions/deadline-exceeded" })).toEqual({
      code: "timeout",
      retryable: true,
    });
  });

  it("treats anything unrecognised as a transient provider failure", () => {
    expect(assistantErrorFrom(new Error("network down"))).toEqual({
      code: "provider_unavailable",
      retryable: true,
    });
    expect(assistantErrorFrom(null)).toEqual({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});
