/**
 * The assistant's provider in the Firebase emulator (GRV-26): a scripted
 * stand-in that answers every turn from a fixed script chosen by the user's
 * last message, so the browser suite can drive the real gateway (its
 * validation, guards, streaming and errors) with no key and no network.
 *
 * `functions/src/index.ts` uses it only when the function runs in the
 * emulator with no `ANTHROPIC_API_KEY` set; a key in `functions/.secret.local`
 * still reaches the real provider (docs/runbooks/assistant-gateway.md). It is
 * never chosen in production.
 *
 * What a message asks for, by a marker anywhere in it:
 *
 * - `[hang]`: one chunk, then nothing until the browser stops the turn.
 * - `[flaky]`: the first turn with this exact message breaks after its first
 *   chunk, which the gateway cannot retry and reports as
 *   `provider_unavailable` (retryable); every later turn with it succeeds.
 *   Make the message unique per test.
 * - `[propose]`: a short reply that ends in a tool call, so the turn returns
 *   a proposal.
 * - `[ask]`: a short reply that ends in `ask_producer` (GRV-42), a single
 *   pick among {@link EMULATOR_ASK}'s options; `[ask-multi]` asks the same
 *   question as a multi-select; `[ask-rich]` asks one whose options point at
 *   the project's first track and bars 1-2, let it be heard, and answer
 *   themselves when the tempo goes to 100 BPM or below
 *   ({@link emulatorRichAsk}).
 * - anything else: a short reply, streamed in pieces with a pause between.
 *
 * Like the rest of `src/assistant`, it imports no Firebase and no SDK.
 */
import { setParameter } from "../commands/definitions/parameters";
import { SONG_TEMPO } from "../domain/parameters";
import { ASK_PRODUCER_TOOL_NAME, type AskProducerInput } from "./ask";
import type { AssistantProvider } from "./provider";
import { ProviderFailure } from "./provider";
import type { ProviderMessagesRequest } from "./providerRequest";
import { toolNameFor } from "./tools";

/** The reply every ordinary turn streams, piece by piece. */
export const EMULATOR_REPLY_CHUNKS = [
  "Here is one idea. ",
  "Try a small change first, ",
  "then listen to it in the loop.",
] as const;

/** How long the scripted reply pauses between pieces, in milliseconds. */
export const EMULATOR_CHUNK_PAUSE_MS = 120;

type Step =
  | { readonly event: unknown }
  | { readonly wait: number }
  | { readonly hang: true }
  | { readonly fail: true };

function textReply(chunks: readonly string[], stopReason = "end_turn"): Step[] {
  return [
    {
      event: {
        type: "message_start",
        message: { id: "msg_emulator", usage: { input_tokens: 100, output_tokens: 1 } },
      },
    },
    { event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
    ...chunks.flatMap((text, index): Step[] => [
      ...(index === 0 ? [] : [{ wait: EMULATOR_CHUNK_PAUSE_MS }]),
      {
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        },
      },
    ]),
    { event: { type: "content_block_stop", index: 0 } },
    {
      event: {
        type: "message_delta",
        delta: { stop_reason: stopReason },
        usage: { output_tokens: 20 },
      },
    },
    { event: { type: "message_stop" } },
  ];
}

/** The question `[ask]` asks. */
export const EMULATOR_ASK = {
  question: "Where should the drop land?",
  context: "The build",
  options: [
    { label: "Bar 17", description: "Straight after the build" },
    { label: "Bar 25", description: "Eight more bars of tension" },
    { label: "Hold it back" },
  ],
  suggested: 0,
} as const satisfies Omit<AskProducerInput, "multiSelect">;

/** A short reply that ends in one tool call. */
function toolReply(text: string, id: string, name: string, input: unknown): Step[] {
  const reply = textReply([text], "tool_use");
  const toolCall: Step[] = [
    {
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id, name, input: {} },
      },
    },
    {
      event: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
      },
    },
    { event: { type: "content_block_stop", index: 1 } },
  ];
  // The text block, then the tool call, then the stop.
  return [...reply.slice(0, -2), ...toolCall, ...reply.slice(-2)];
}

function proposalReply(): Step[] {
  return toolReply("I can set the tempo to 100 BPM.", "toolu_emulator", "parameter_set", {
    target: { kind: "song", parameter: "tempo" },
    value: 100,
  });
}

/**
 * The question `[ask-rich]` asks, about `trackId`: an option that points at
 * the track and plays it, one about bars 1-2, and one that previews the song
 * at 100 BPM and is answered by setting the tempo there.
 */
export function emulatorRichAsk(trackId: string | null): AskProducerInput {
  const slower = setParameter({ scope: "song", parameterId: SONG_TEMPO.id }, 100);
  return {
    question: "What should change first?",
    context: "The groove",
    options: [
      ...(trackId
        ? [
            {
              label: "The first track",
              ref: { kind: "track" as const, trackId },
              sound: { kind: "track" as const, trackId },
            },
          ]
        : []),
      { label: "The opening", ref: { kind: "bars", startBar: 1, endBar: 2 } },
      {
        label: "Slower, at 100 BPM",
        description: "Set the tempo yourself to answer",
        sound: {
          kind: "preview",
          calls: [{ name: toolNameFor(slower.type), input: { ...slower.payload } }],
        },
        doneWhen: { kind: "tempo", max: 100 },
      },
    ],
    suggested: 0,
    multiSelect: false,
  };
}

/** The first track the turn's project context names, or null. */
function firstTrackId(request: ProviderMessagesRequest): string | null {
  const block = request.system.find((part) => part.text.startsWith(PROJECT_PREFIX));
  if (!block) return null;
  try {
    const context = JSON.parse(block.text.slice(PROJECT_PREFIX.length)) as {
      tracks?: { id?: unknown }[];
    };
    const id = context.tracks?.[0]?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** How `buildSystemBlocks` (`prompt.ts`) introduces the project. */
const PROJECT_PREFIX = "The open project, as JSON:\n";

function richAskReply(request: ProviderMessagesRequest): Step[] {
  return toolReply(
    "Let's pick a place to start.",
    "toolu_ask_rich",
    ASK_PRODUCER_TOOL_NAME,
    emulatorRichAsk(firstTrackId(request)),
  );
}

function askReply(multiSelect: boolean): Step[] {
  return toolReply(
    "One question before I change anything.",
    "toolu_ask",
    ASK_PRODUCER_TOOL_NAME,
    {
      ...EMULATOR_ASK,
      multiSelect,
    },
  );
}

function lastUserMessage(request: ProviderMessagesRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === "user") return message.content;
  }
  return "";
}

/**
 * `[flaky]`'s memory: true the first time it is asked about a message, false
 * every time after. The emulator can answer a retry from a different worker
 * process than the first try, so the function hands in one that every worker
 * shares; the default lives in this process alone.
 */
export type FirstTimeCheck = (message: string) => boolean;

function inProcessFirstTime(): FirstTimeCheck {
  const seen = new Set<string>();
  return (message) => {
    if (seen.has(message)) return false;
    seen.add(message);
    return true;
  };
}

/** A provider that answers from the scripts above. */
export function createEmulatorAssistantProvider(
  firstTime: FirstTimeCheck = inProcessFirstTime(),
): AssistantProvider {
  function scriptFor(message: string, request: ProviderMessagesRequest): Step[] {
    if (message.includes("[hang]")) {
      return [...textReply([EMULATOR_REPLY_CHUNKS[0]]).slice(0, 3), { hang: true }];
    }
    if (message.includes("[flaky]") && firstTime(message)) {
      return [...textReply([EMULATOR_REPLY_CHUNKS[0]]).slice(0, 3), { fail: true }];
    }
    if (message.includes("[propose]")) return proposalReply();
    if (message.includes("[ask-rich]")) return richAskReply(request);
    if (message.includes("[ask-multi]")) return askReply(true);
    if (message.includes("[ask]")) return askReply(false);
    return textReply(EMULATOR_REPLY_CHUNKS);
  }

  return {
    stream(request, signal) {
      const script = scriptFor(lastUserMessage(request), request);
      return (async function* () {
        for (const step of script) {
          if (signal.aborted) return;
          if ("event" in step) {
            yield step.event;
          } else if ("wait" in step) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, step.wait);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                { once: true },
              );
            });
          } else if ("hang" in step) {
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            return;
          } else {
            throw new ProviderFailure("server_error", 500);
          }
        }
      })();
    },
  };
}

/**
 * Whether the function should answer from the emulator's script: it runs in
 * the Firebase emulator and no real key was supplied.
 */
export function usesEmulatorProvider(
  env: Readonly<Record<string, string | undefined>>,
  apiKey: string,
): boolean {
  return env.FUNCTIONS_EMULATOR === "true" && apiKey.trim().length === 0;
}
