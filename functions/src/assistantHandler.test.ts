import type { CallableRequest, CallableResponse } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";
import type {
  AssistantStreamChunk,
  AssistantTurnRequest,
} from "../../src/assistant/protocol";
import type { AssistantTurnLog } from "../../src/assistant/telemetry";
import {
  type CallScript,
  createScriptedAssistantProvider,
  replyEvents,
} from "../../src/testing/scriptedAssistantProvider";
import { createAssistantHandler } from "./assistantHandler";

const turn: AssistantTurnRequest = {
  messages: [{ role: "user", text: "hello" }],
  context: {
    projectName: "Song",
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    totalTicks: 0,
    tracks: [],
    sections: [],
    selection: null,
  },
};

function callable(
  auth: { uid: string; provider: string } | null,
  data: unknown = turn,
): CallableRequest<unknown> {
  return {
    data,
    auth: auth
      ? {
          uid: auth.uid,
          token: { firebase: { sign_in_provider: auth.provider } },
        }
      : undefined,
    acceptsStreaming: true,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>;
}

function streamingResponse(signal = new AbortController().signal) {
  const chunks: AssistantStreamChunk[] = [];
  const response: CallableResponse<AssistantStreamChunk> = {
    signal,
    sendChunk: async (chunk) => {
      chunks.push(chunk);
      return true;
    },
  };
  return { chunks, response };
}

function handler(scripts: readonly CallScript[]) {
  const logs: AssistantTurnLog[] = [];
  const provider = createScriptedAssistantProvider(scripts);
  return {
    logs,
    provider,
    handle: createAssistantHandler(() => ({
      provider,
      log: (record) => logs.push(record),
      sleep: async () => {},
    })),
  };
}

async function httpsErrorOf(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error("expected an HttpsError");
}

describe("createAssistantHandler", () => {
  it("streams chunks to the callable response and returns the reply", async () => {
    const { handle } = handler([replyEvents(["Hello ", "there"])]);
    const { chunks, response } = streamingResponse();
    const result = await handle(
      callable({ uid: "u1", provider: "google.com" }),
      response,
    );
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Hello ", "there"]);
    expect(result.text).toBe("Hello there");
  });

  it("refuses a call with no auth as unauthenticated", async () => {
    const { handle, provider } = handler([replyEvents(["x"])]);
    const error = await httpsErrorOf(
      handle(callable(null), streamingResponse().response),
    );
    expect(error.code).toBe("unauthenticated");
    expect(error.details).toEqual({ code: "unauthenticated", retryable: false });
    expect(provider.requests).toHaveLength(0);
  });

  it("reads a guest from the ID token's sign-in provider", async () => {
    const { handle } = handler([replyEvents(["x"])]);
    const error = await httpsErrorOf(
      handle(callable({ uid: "g", provider: "anonymous" }), streamingResponse().response),
    );
    expect(error.code).toBe("unauthenticated");
  });

  it.each([
    [[[{ fail: "rejected", status: 400 }]], "failed-precondition", "provider_error"],
    [[[{ fail: "overloaded", status: 529 }]], "unavailable", "provider_unavailable"],
    [[[{ event: "garbage" }]], "internal", "malformed_response"],
  ] satisfies [CallScript[], string, string][])(
    "maps a provider failure onto an HttpsError (%#)",
    async (scripts, httpsCode, code) => {
      const { handle } = handler(scripts);
      const error = await httpsErrorOf(
        handle(
          callable({ uid: "u", provider: "google.com" }),
          streamingResponse().response,
        ),
      );
      expect(error.code).toBe(httpsCode);
      expect((error.details as { code: string }).code).toBe(code);
    },
  );

  it("maps a refused request onto invalid-argument", async () => {
    const { handle } = handler([replyEvents(["x"])]);
    const error = await httpsErrorOf(
      handle(callable({ uid: "u", provider: "google.com" }, { messages: [] }), undefined),
    );
    expect(error.code).toBe("invalid-argument");
  });

  it("cancels when the client disconnects", async () => {
    const controller = new AbortController();
    const { handle, logs } = handler([
      [...replyEvents(["a"]).slice(0, 3), { hang: true }],
    ]);
    const { response } = streamingResponse(controller.signal);
    const pending = handle(callable({ uid: "u", provider: "google.com" }), response);
    setTimeout(() => controller.abort(), 10);
    const error = await httpsErrorOf(pending);
    expect(error.code).toBe("cancelled");
    expect(logs[0].outcome).toBe("cancelled");
  });
});
