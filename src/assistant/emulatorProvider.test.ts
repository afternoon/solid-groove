import { describe, expect, it } from "vitest";
import { executeTransaction } from "../commands/execute";
import type { Project } from "../domain/entities";
import { createReferenceProject, createSliceFixtureProject } from "../domain/fixtures";
import { SONG_SWING } from "../domain/parameters";
import {
  createEmulatorAssistantProvider,
  EMULATOR_ASK,
  EMULATOR_REPLY_CHUNKS,
  LOOSEN_EXPLANATION,
  LOOSEN_SWING,
  LOOSEN_VOLUME_DROP_DB,
  usesEmulatorProvider,
} from "./emulatorProvider";
import { type AssistantGatewayDeps, runAssistantTurn } from "./gateway";
import { createInMemoryGuardStores } from "./inMemoryGuardStores";
import { buildAssistantPayload } from "./payload";
import { validateProposal } from "./proposal";
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
  project: Project = createReferenceProject(),
): { chunks: AssistantStreamChunk[]; result: Promise<AssistantTurnResult> } {
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

  it("ends [propose] in a proposal the browser accepts", async () => {
    const reply = await turn(gateway(), "Change it [propose]").result;
    expect(reply.stopReason).toBe("tool_use");
    expect(reply.proposal?.calls).toHaveLength(1);
    const validation = validateProposal(createReferenceProject(), reply.proposal);
    expect(validation.ok).toBe(true);
  });

  it("answers CF-027's 'Loosen the beat' with swing and a quieter track", async () => {
    const project = createSliceFixtureProject();
    const track = project.song.tracks.find((candidate) => candidate.name === "BD");
    if (!track) throw new Error("the fixture has no BD");
    const signal = new AbortController().signal;
    const reply = await turn(gateway(), "Loosen the beat", signal, project).result;
    expect(reply.stopReason).toBe("tool_use");
    const validation = validateProposal(project, reply.proposal);
    if (!validation.ok) throw new Error(JSON.stringify(validation.issues));
    expect(validation.proposal.commands).toHaveLength(2);
    const applied = executeTransaction(project, validation.proposal.commands, {
      actor: "assistant",
    });
    if (!applied.ok) throw new Error("the proposal did not apply");
    expect(applied.project.song.swing).toBe(LOOSEN_SWING);
    expect(LOOSEN_SWING).toBeGreaterThan(SONG_SWING.defaultValue);
    const after = applied.project.song.tracks.find(
      (candidate) => candidate.id === track.id,
    );
    expect(after?.mixer.volume).toBe(track.mixer.volume - LOOSEN_VOLUME_DROP_DB);
    expect(validation.proposal.explanation).toEqual(LOOSEN_EXPLANATION);
  });

  it("ends [ask] in a question for the producer, and [ask-multi] in a multi-select", async () => {
    const single = await turn(gateway(), "Help [ask]").result;
    expect(single.stopReason).toBe("tool_use");
    expect(single.proposal).toBeNull();
    expect(single.ask).toEqual({ id: "toolu_ask", ...EMULATOR_ASK, multiSelect: false });
    const multi = await turn(gateway(), "Help [ask-multi]").result;
    expect(multi.ask?.multiSelect).toBe(true);
  });

  it("ends [ask-rich] in a question about the project's first track, with a preview that applies", async () => {
    const project = createReferenceProject();
    const reply = await turn(gateway(), "Where do I start? [ask-rich]").result;
    const options = reply.ask?.options ?? [];
    expect(options.map((option) => option.label)).toEqual([
      "The first track",
      "The opening",
      "Slower, at 100 BPM",
    ]);
    expect(options[0]?.ref).toEqual({
      kind: "track",
      trackId: project.song.tracks[0]?.id,
    });
    const preview = options[2]?.sound;
    if (preview?.kind !== "preview") throw new Error("the third option has no preview");
    const validation = validateProposal(project, {
      baseRevision: project.metadata.revision,
      calls: preview.calls,
    });
    expect(validation.ok).toBe(true);
    expect(options[2]?.doneWhen).toEqual({ kind: "tempo", max: 100 });
  });

  it("is only chosen in the emulator, and only with no key", () => {
    expect(usesEmulatorProvider({ FUNCTIONS_EMULATOR: "true" }, "")).toBe(true);
    expect(usesEmulatorProvider({ FUNCTIONS_EMULATOR: "true" }, "sk-real")).toBe(false);
    expect(usesEmulatorProvider({}, "")).toBe(false);
  });
});
