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
 *   a proposal: the tempo to 100 BPM.
 * - "Loosen the beat" (CF-027, any case): a proposal of two changes, swing to
 *   58% and the BD track 3 dB quieter, read from the project context.
 * - anything "dusty" or "dustier" (CF-034, any case): a recommendation of up to
 *   three kicks the project does not use, the grittiest first, all from the
 *   pack of the best one, for the BD track (or the first), read from the
 *   library the turn carries (GRV-23). With no library, or no such kick, a
 *   short reply saying so.
 * - anything else: a short reply, streamed in pieces with a pause between.
 *
 * Like the rest of `src/assistant`, it imports no Firebase and no SDK.
 */
import { LIBRARY_BLOCK_HEADING, PROJECT_BLOCK_HEADING } from "./prompt";
import type { AssistantLibraryContext } from "./protocol";
import type { AssistantProvider } from "./provider";
import { ProviderFailure } from "./provider";
import type { ProviderMessagesRequest } from "./providerRequest";
import { RECOMMEND_SOUNDS_TOOL } from "./recommendation";

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

/** One tool call the scripted reply makes. */
interface ScriptedCall {
  readonly name: string;
  readonly input: unknown;
}

/** A short reply that ends in `calls`, so the turn returns a proposal. */
function proposalReply(text: string, calls: readonly ScriptedCall[]): Step[] {
  const reply = textReply([text], "tool_use");
  const toolCalls = calls.flatMap((call, offset): Step[] => {
    const index = offset + 1;
    return [
      {
        event: {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: `toolu_emulator_${index}`,
            name: call.name,
            input: {},
          },
        },
      },
      {
        event: {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) },
        },
      },
      { event: { type: "content_block_stop", index } },
    ];
  });
  // The text block, then the tool calls, then the stop.
  return [...reply.slice(0, -2), ...toolCalls, ...reply.slice(-2)];
}

/** `[propose]`'s one change: the tempo to 100 BPM. */
function tempoProposal(): Step[] {
  return proposalReply("I can set the tempo to 100 BPM.", [
    {
      name: "parameter_set",
      input: { target: { scope: "song", parameterId: "song.tempo" }, value: 100 },
    },
  ]);
}

/** The swing "Loosen the beat" proposes, in percent. */
export const LOOSEN_SWING = 58;
/** How much quieter "Loosen the beat" makes the track, in dB. */
export const LOOSEN_VOLUME_DROP_DB = 3;
/** The track "Loosen the beat" turns down, by name, when the song has one. */
export const LOOSEN_TRACK_NAME = "BD";

interface ContextTrack {
  readonly id: string;
  readonly name: string;
  readonly volume: number;
}

/** The JSON a system block carries after `heading`, or null when none does. */
function systemJson(request: ProviderMessagesRequest, heading: string): unknown {
  for (const block of request.system) {
    const at = block.text.indexOf(heading);
    if (at < 0) continue;
    try {
      return JSON.parse(block.text.slice(at + heading.length));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The tracks in the project context the gateway put in the system prompt
 * (`prompt.ts`), as the scripted provider needs them: IDs, names and volumes.
 */
function contextTracks(request: ProviderMessagesRequest): readonly ContextTrack[] {
  const context = systemJson(request, PROJECT_BLOCK_HEADING) as {
    tracks?: readonly ContextTrack[];
  } | null;
  return context?.tracks ?? [];
}

/**
 * CF-027's script: asked to loosen the beat, the swing goes to 58% and the
 * BD track (or the first track, in a song with no BD) 3 dB quieter. With no
 * track at all, only the swing.
 */
function loosenProposal(request: ProviderMessagesRequest): Step[] {
  const tracks = contextTracks(request);
  const track =
    tracks.find((candidate) => candidate.name === LOOSEN_TRACK_NAME) ?? tracks[0];
  const calls: ScriptedCall[] = [
    {
      name: "parameter_set",
      input: {
        target: { scope: "song", parameterId: "song.swing" },
        value: LOOSEN_SWING,
      },
    },
  ];
  if (track) {
    calls.push({
      name: "parameter_set",
      input: {
        target: { scope: "track", trackId: track.id, parameterId: "track.volume" },
        value: Math.max(-60, track.volume - LOOSEN_VOLUME_DROP_DB),
      },
    });
  }
  return proposalReply(
    `A little swing pushes every second 16th late, so the beat sounds played rather than programmed${track ? `, and ${track.name} sits back a little so the groove leads` : ""}.`,
    calls,
  );
}

/** The role "anything dustier?" recommends. */
export const DUSTIER_ROLE = "kick";
/** The tags that make a sound dustier, the strongest first. */
const DUSTY_TAGS = ["gritty", "lofi", "warm", "soft"] as const;

/** How dusty a sound's tags say it is: higher is dustier. */
function dustiness(tags: readonly string[]): number {
  return DUSTY_TAGS.reduce(
    (score, tag, index) => score + (tags.includes(tag) ? DUSTY_TAGS.length - index : 0),
    0,
  );
}

/**
 * CF-034's script: asked for something dustier, the kicks the project does
 * not use, dustiest first, from the pack of the dustiest, for the BD track or
 * the first track. Read from the library the turn carries; with none, or no
 * kick to offer, a reply that says so.
 */
function dustierRecommendation(request: ProviderMessagesRequest): Step[] {
  const library = systemJson(
    request,
    LIBRARY_BLOCK_HEADING,
  ) as AssistantLibraryContext | null;
  const kicks = (library?.packs ?? []).flatMap((pack) =>
    pack.sounds
      .filter(
        (sound) =>
          sound.role === DUSTIER_ROLE && sound.type === "one-shot" && !sound.inProject,
      )
      .map((sound) => ({ pack, sound, score: dustiness(sound.tags) })),
  );
  // A stable sort, so equally dusty kicks keep the library's order.
  const ranked = [...kicks].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    return textReply(["I can't find a dustier kick in the library right now."]);
  }
  const picks = ranked.filter((entry) => entry.pack.id === best.pack.id).slice(0, 3);
  const tracks = contextTracks(request);
  const track =
    tracks.find((candidate) => candidate.name === LOOSEN_TRACK_NAME) ?? tracks[0];
  return proposalReply(
    `${best.pack.name} has kicks with a softer, grittier attack that sit back in the beat. Try ${best.sound.name} first.`,
    [
      {
        name: RECOMMEND_SOUNDS_TOOL,
        input: {
          packId: best.pack.id,
          soundIds: picks.map((entry) => entry.sound.id),
          reason: "Softer, grittier kicks that sit back under the beat.",
          ...(track ? { trackId: track.id } : {}),
        },
      },
    ],
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
  function scriptFor(request: ProviderMessagesRequest): Step[] {
    const message = lastUserMessage(request);
    if (message.includes("[hang]")) {
      return [...textReply([EMULATOR_REPLY_CHUNKS[0]]).slice(0, 3), { hang: true }];
    }
    if (message.includes("[flaky]") && firstTime(message)) {
      return [...textReply([EMULATOR_REPLY_CHUNKS[0]]).slice(0, 3), { fail: true }];
    }
    if (message.includes("[propose]")) return tempoProposal();
    if (/loosen the beat/i.test(message)) return loosenProposal(request);
    if (/\bdust(y|ier)\b/i.test(message)) return dustierRecommendation(request);
    return textReply(EMULATOR_REPLY_CHUNKS);
  }

  return {
    stream(request, signal) {
      const script = scriptFor(request);
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
