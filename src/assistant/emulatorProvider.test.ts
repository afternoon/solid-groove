import { describe, expect, it } from "vitest";
import { createReferenceProject } from "../domain/fixtures";
import {
  createEmulatorAssistantProvider,
  EMULATOR_ASK,
  EMULATOR_REPLY_CHUNKS,
  usesEmulatorProvider,
} from "./emulatorProvider";
import { type AssistantGatewayDeps, runAssistantTurn } from "./gateway";
import { createInMemoryGuardStores } from "./inMemoryGuardStores";
import { buildAssistantPayload } from "./payload";
import {
  AssistantGatewayError,
  type AssistantStreamChunk,
  type AssistantTurnResult,
} from "./protocol";

/** The emulator's provider, behind the real gateway, as the function runs it. */
function gateway(): AssistantGatewayDeps {
  return {
    provider: createEmulatorAssistantProvider(),
    guards: createInMemoryGuardStores(),
    log: () => {},
    now: () => 1_000,
    sleep: async () => {},
  };
}

function turn(
  deps: AssistantGatewayDeps,
  text: string,
  signal: AbortSignal = new AbortController().signal,
): { chunks: AssistantStreamChunk[]; result: Promise<AssistantTurnResult> } {
  const project = createReferenceProject();
  const chunks: AssistantStreamChunk[] = [];
  const result = runAssistantTurn(
    deps,
    { uid: "uid-1", signInProvider: "google.com" },
    {
      projectRevision: project.metadata.revision,
      messages: [{ role: "user", text }],
      context: buildAssistantPayload(project),
    },
    { signal, onChunk: (chunk) => chunks.push(chunk) },
  );
  return { chunks, result };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AssistantGatewayError) return error.code;
    throw error;
  }
  return "completed";
}

describe("the emulator's assistant provider", () => {
  it("streams its reply in pieces and completes the turn", async () => {
    const { chunks, result } = turn(gateway(), "Make it groove");
    const reply = await result;
    expect(chunks.map((chunk) => chunk.text)).toEqual([...EMULATOR_REPLY_CHUNKS]);
    expect(reply.text).toBe(EMULATOR_REPLY_CHUNKS.join(""));
    expect(reply.stopReason).toBe("end_turn");
    expect(reply.proposal).toBeNull();
  });

  it("hangs on [hang] until the turn is stopped, which cancels it", async () => {
    const controller = new AbortController();
    const { chunks, result } = turn(gateway(), "Keep going [hang]", controller.signal);
    await expect.poll(() => chunks.length).toBe(1);
    controller.abort();
    expect(await codeOf(result)).toBe("cancelled");
  });

  it("fails [flaky] once as a retryable provider failure, then answers", async () => {
    const deps = gateway();
    const first = turn(deps, "Again [flaky] 1");
    expect(await codeOf(first.result)).toBe("provider_unavailable");
    expect(first.chunks).toHaveLength(1);
    const second = turn(deps, "Again [flaky] 1");
    expect((await second.result).text).toBe(EMULATOR_REPLY_CHUNKS.join(""));
  });

  it("asks the memory it is given whether [flaky] failed before", async () => {
    const asked: string[] = [];
    const deps = {
      ...gateway(),
      provider: createEmulatorAssistantProvider((message) => {
        asked.push(message);
        return false;
      }),
    };
    // Another worker already failed this message: this one answers.
    const reply = await turn(deps, "Again [flaky] 2").result;
    expect(reply.text).toBe(EMULATOR_REPLY_CHUNKS.join(""));
    expect(asked).toEqual(["Again [flaky] 2"]);
  });

  it("ends [propose] in a proposal", async () => {
    const reply = await turn(gateway(), "Change it [propose]").result;
    expect(reply.stopReason).toBe("tool_use");
    expect(reply.proposal?.calls).toHaveLength(1);
  });

  it("ends [ask] in a question for the producer, and [ask-multi] in a multi-select", async () => {
    const single = await turn(gateway(), "Help [ask]").result;
    expect(single.stopReason).toBe("tool_use");
    expect(single.proposal).toBeNull();
    expect(single.ask).toEqual({ id: "toolu_ask", ...EMULATOR_ASK, multiSelect: false });
    const multi = await turn(gateway(), "Help [ask-multi]").result;
    expect(multi.ask?.multiSelect).toBe(true);
  });

  it("is only chosen in the emulator, and only with no key", () => {
    expect(usesEmulatorProvider({ FUNCTIONS_EMULATOR: "true" }, "")).toBe(true);
    expect(usesEmulatorProvider({ FUNCTIONS_EMULATOR: "true" }, "sk-real")).toBe(false);
    expect(usesEmulatorProvider({}, "")).toBe(false);
  });
});
