import { describe, expect, it } from "vitest";
import { createReferenceProject } from "../domain/fixtures";
import { buildAssistantContext } from "../projection/assistantContextProjection";
import {
  type CallScript,
  createScriptedAssistantProvider,
  replyEvents,
} from "../testing/scriptedAssistantProvider";
import {
  ASSISTANT_CALL_LIMITS,
  ASSISTANT_MODELS,
  type AssistantCallLimits,
} from "./config";
import {
  type AssistantCaller,
  type AssistantGatewayDeps,
  pseudonymousUserId,
  runAssistantTurn,
} from "./gateway";
import { assistantContextPayload } from "./payload";
import { ASSISTANT_PROMPT_VERSION } from "./prompt";
import {
  type AssistantErrorCode,
  AssistantGatewayError,
  type AssistantStreamChunk,
  type AssistantTurnRequest,
} from "./protocol";
import { type AssistantTurnLog, TURN_LOG_KEYS } from "./telemetry";

const SIGNED_IN: AssistantCaller = {
  uid: "uid-secret-1234",
  signInProvider: "google.com",
};

function request(overrides: Partial<AssistantTurnRequest> = {}): AssistantTurnRequest {
  return {
    messages: [{ role: "user", text: "Make the bass hit harder" }],
    context: assistantContextPayload(buildAssistantContext(createReferenceProject())),
    ...overrides,
  };
}

interface Harness {
  deps: AssistantGatewayDeps;
  logs: AssistantTurnLog[];
  chunks: AssistantStreamChunk[];
  sleeps: number[];
  provider: ReturnType<typeof createScriptedAssistantProvider>;
}

function harness(
  scripts: readonly CallScript[],
  limits: Partial<AssistantCallLimits> = {},
): Harness {
  const provider = createScriptedAssistantProvider(scripts);
  const logs: AssistantTurnLog[] = [];
  const sleeps: number[] = [];
  let clock = 1_000;
  return {
    provider,
    logs,
    chunks: [],
    sleeps,
    deps: {
      provider,
      log: (record) => logs.push(record),
      now: () => {
        clock += 5;
        return clock;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      limits: { ...ASSISTANT_CALL_LIMITS, attemptTimeoutMs: 200, ...limits },
    },
  };
}

function run(
  h: Harness,
  body: unknown = request(),
  caller: AssistantCaller = SIGNED_IN,
  signal: AbortSignal = new AbortController().signal,
) {
  return runAssistantTurn(h.deps, caller, body, {
    signal,
    onChunk: (chunk) => h.chunks.push(chunk),
  });
}

async function failure(promise: Promise<unknown>): Promise<AssistantGatewayError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AssistantGatewayError) return error;
    throw error;
  }
  throw new Error("expected the turn to fail");
}

async function expectCode(promise: Promise<unknown>, code: AssistantErrorCode) {
  expect((await failure(promise)).code).toBe(code);
}

describe("runAssistantTurn: a completed turn", () => {
  it("streams the reply's text as it arrives and returns the whole of it", async () => {
    const h = harness([replyEvents(["Push the ", "kick ", "up 2 dB."])]);
    const result = await run(h);
    expect(h.chunks).toEqual([
      { type: "text", text: "Push the " },
      { type: "text", text: "kick " },
      { type: "text", text: "up 2 dB." },
    ]);
    expect(result).toEqual({
      text: "Push the kick up 2 dB.",
      stopReason: "end_turn",
      model: ASSISTANT_MODELS["claude-sonnet-5"].id,
      promptVersion: ASSISTANT_PROMPT_VERSION,
    });
  });

  it("never streams the model's thinking", async () => {
    const h = harness([replyEvents(["Done."], { withThinking: true })]);
    const result = await run(h);
    expect(result.text).toBe("Done.");
    expect(JSON.stringify(h.chunks)).not.toContain("private reasoning");
  });

  it("returns a refusal or a cut-off reply with its stop reason", async () => {
    const h = harness([replyEvents(["I can't help"], { stopReason: "max_tokens" })]);
    expect((await run(h)).stopReason).toBe("max_tokens");
  });

  it("sends the project context and a pseudonymous ID, never the uid", async () => {
    const h = harness([replyEvents(["ok"])]);
    await run(h);
    const sent = h.provider.requests[0];
    expect(sent.system[1].text).toContain(createReferenceProject().metadata.name);
    expect(sent.metadata.user_id).toBe(await pseudonymousUserId(SIGNED_IN.uid as string));
    expect(JSON.stringify(sent)).not.toContain(SIGNED_IN.uid);
  });
});

describe("runAssistantTurn: auth", () => {
  it("refuses a caller with no account before calling the provider", async () => {
    const h = harness([replyEvents(["ok"])]);
    await expectCode(
      run(h, request(), { uid: null, signInProvider: null }),
      "unauthenticated",
    );
    expect(h.provider.requests).toHaveLength(0);
    expect(h.logs.map((log) => log.outcome)).toEqual(["unauthenticated"]);
  });

  it("refuses a guest (anonymous) session", async () => {
    const h = harness([replyEvents(["ok"])]);
    await expectCode(
      run(h, request(), { uid: "guest", signInProvider: "anonymous" }),
      "unauthenticated",
    );
    expect(h.provider.requests).toHaveLength(0);
  });
});

describe("runAssistantTurn: the request", () => {
  it("refuses a context field ADR 0007's allowlist does not name", async () => {
    const h = harness([replyEvents(["ok"])]);
    const body = request();
    const leaky = {
      ...body,
      context: { ...body.context, assetUrl: "https://storage.example/sound.wav" },
    };
    await expectCode(run(h, leaky), "invalid_request");
    expect(h.provider.requests).toHaveLength(0);
  });

  it("refuses a conversation that does not end with the user", async () => {
    const h = harness([replyEvents(["ok"])]);
    const body = request({
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "hello" },
      ],
    });
    await expectCode(run(h, body), "invalid_request");
  });

  it("resends a bounded history, oldest messages dropped, newest kept", async () => {
    const h = harness([replyEvents(["ok"])]);
    const long = "x".repeat(7_900);
    const messages = Array.from({ length: 41 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: index === 40 ? "the newest" : long,
    }));
    await run(h, request({ messages }));
    const sent = h.provider.requests[0].messages;
    expect(sent.length).toBeLessThan(messages.length);
    expect(sent[0].role).toBe("user");
    expect(sent[sent.length - 1].content).toBe("the newest");
    expect(h.logs[0].historyDropped).toBe(messages.length - sent.length);
  });
});

describe("runAssistantTurn: timeout", () => {
  it("abandons a provider call that takes too long, without retrying", async () => {
    const h = harness([[...replyEvents(["Partly"]).slice(0, 2), { hang: true }]], {
      attemptTimeoutMs: 20,
    });
    await expectCode(run(h), "timeout");
    expect(h.provider.requests).toHaveLength(1);
    expect(h.provider.aborted).toBe(1);
    expect(h.logs[0]).toMatchObject({ outcome: "timeout", attempts: 1 });
  });
});

describe("runAssistantTurn: cancellation", () => {
  it("aborts the provider call when the browser goes away mid-reply", async () => {
    const controller = new AbortController();
    const h = harness([[...replyEvents(["First "]).slice(0, 3), { hang: true }]]);
    const turn = runAssistantTurn(h.deps, SIGNED_IN, request(), {
      signal: controller.signal,
      onChunk: (chunk) => {
        h.chunks.push(chunk);
        controller.abort();
      },
    });
    await expectCode(turn, "cancelled");
    expect(h.chunks).toEqual([{ type: "text", text: "First " }]);
    expect(h.provider.aborted).toBe(1);
    expect(h.logs[0].outcome).toBe("cancelled");
  });

  it("does not call the provider at all for a request already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness([replyEvents(["ok"])]);
    await expectCode(run(h, request(), SIGNED_IN, controller.signal), "cancelled");
    expect(h.provider.requests).toHaveLength(0);
  });
});

describe("runAssistantTurn: malformed stream", () => {
  const start = replyEvents(["x"])[0];

  const RETRIED = ASSISTANT_CALL_LIMITS.maxAttempts;
  it.each([
    ["an event that is not an object", [start, { event: "garbage" }], RETRIED],
    [
      "a known event in the wrong shape",
      [start, { event: { type: "content_block_delta", index: "zero", delta: {} } }],
      RETRIED,
    ],
    [
      "text before the message starts",
      [
        {
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text" },
          },
        },
      ],
      RETRIED,
    ],
    [
      "a block type a text turn never has",
      [
        start,
        {
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use" },
          },
        },
      ],
      RETRIED,
    ],
    ["an empty reply", replyEvents([]), RETRIED],
    // These two have already streamed text, so they are not retried.
    ["a stream that ends without message_stop", replyEvents(["cut"]).slice(0, 4), 1],
    [
      "a stop reason a text turn never has",
      replyEvents(["a"], { stopReason: "tool_use" }),
      1,
    ],
  ] satisfies [string, CallScript, number][])("fails on %s", async (_, script, calls) => {
    const h = harness([script]);
    await expectCode(run(h), "malformed_response");
    expect(h.provider.requests).toHaveLength(calls);
    expect(h.logs[0].failures).toEqual(Array(calls).fill("malformed"));
  });

  it("skips an event type it does not know, as the API asks", async () => {
    const events = replyEvents(["fine"]);
    events.splice(1, 0, { event: { type: "some_future_event", data: 1 } });
    const h = harness([events]);
    expect((await run(h)).text).toBe("fine");
  });

  it("recovers when a retry streams cleanly", async () => {
    const h = harness([[{ event: "garbage" }], replyEvents(["second time"])]);
    expect((await run(h)).text).toBe("second time");
    expect(h.logs[0]).toMatchObject({ outcome: "completed", attempts: 2 });
  });

  it("does not retry once text has reached the browser", async () => {
    const h = harness([[...replyEvents(["half a reply"]).slice(0, 3), { event: 42 }]]);
    await expectCode(run(h), "malformed_response");
    expect(h.provider.requests).toHaveLength(1);
  });
});

describe("runAssistantTurn: provider error", () => {
  it("retries a transient failure with backoff, then succeeds", async () => {
    const h = harness([
      [{ fail: "overloaded", status: 529 }],
      [{ fail: "rate_limited", status: 429 }],
      replyEvents(["third time lucky"]),
    ]);
    expect((await run(h)).text).toBe("third time lucky");
    expect(h.sleeps).toEqual([
      ASSISTANT_CALL_LIMITS.retryBackoffMs,
      ASSISTANT_CALL_LIMITS.retryBackoffMs * 2,
    ]);
    expect(h.logs[0]).toMatchObject({
      attempts: 3,
      failures: ["overloaded", "rate_limited"],
    });
  });

  it("gives up as unavailable after the last attempt", async () => {
    const h = harness([[{ fail: "server_error", status: 500 }]]);
    const error = await failure(run(h));
    expect(error.code).toBe("provider_unavailable");
    expect(error.details).toEqual({ code: "provider_unavailable", retryable: true });
    expect(h.provider.requests).toHaveLength(ASSISTANT_CALL_LIMITS.maxAttempts);
  });

  it("never retries a request the provider rejected", async () => {
    const h = harness([[{ fail: "rejected", status: 400 }], replyEvents(["unused"])]);
    const error = await failure(run(h));
    expect(error.code).toBe("provider_error");
    expect(error.details.retryable).toBe(false);
    expect(h.provider.requests).toHaveLength(1);
    expect(h.logs[0].providerStatus).toBe(400);
  });
});

describe("runAssistantTurn: redacted telemetry", () => {
  const SECRETS = [
    "Secret Project Name",
    "Track named for a person",
    "my private message",
    "assistant said something private",
    SIGNED_IN.uid as string,
  ];

  function secretRequest(): AssistantTurnRequest {
    const body = request({
      messages: [
        { role: "user", text: "earlier" },
        { role: "assistant", text: "assistant said something private" },
        { role: "user", text: "my private message" },
      ],
    });
    return {
      ...body,
      context: {
        ...body.context,
        projectName: "Secret Project Name",
        tracks: body.context.tracks.map((track) => ({
          ...track,
          name: "Track named for a person",
        })),
      },
    };
  }

  it.each([
    ["a completed turn", [replyEvents(["a reply that is also private"])]],
    ["a failed turn", [[{ fail: "rejected", status: 400 }]]],
    [
      "a malformed turn",
      [[{ event: { type: "message_start", message: "Secret Project Name" } }]],
    ],
  ] satisfies [string, CallScript[]][])(
    "logs one record of codes and counts for %s",
    async (_, scripts) => {
      const h = harness(scripts);
      await run(h, secretRequest()).catch(() => {});
      expect(h.logs).toHaveLength(1);
      expect(Object.keys(h.logs[0]).sort()).toEqual([...TURN_LOG_KEYS].sort());
      const serialized = JSON.stringify(h.logs);
      for (const secret of [...SECRETS, "a reply that is also private"]) {
        expect(serialized).not.toContain(secret);
      }
    },
  );

  it("counts tokens over every attempt", async () => {
    const h = harness([
      [...replyEvents(["x"], { inputTokens: 50 }).slice(0, 1), { fail: "network" }],
      replyEvents(["ok"], { inputTokens: 70, outputTokens: 9 }),
    ]);
    await run(h);
    expect(h.logs[0]).toMatchObject({ inputTokens: 120, outputTokens: 10 });
  });
});
