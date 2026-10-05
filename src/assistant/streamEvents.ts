/**
 * Reading and validating the provider's stream (#69: "response validation").
 *
 * Each raw event is checked against the Messages API's shape before the
 * gateway acts on it. An event type this module does not know is skipped, as
 * the API asks clients to do; a known one in the wrong shape is a
 * {@link ProviderFailure} of kind `malformed`, never a silently dropped chunk.
 * The order the events arrive in is checked by {@link StreamReader}.
 */
import { z } from "zod";
import type { AssistantStopReason } from "./protocol";
import { ProviderFailure } from "./provider";

const tokens = z.int().min(0);

/** Token counts as the provider reports them; any of them may be absent. */
const usageSchema = z.looseObject({
  input_tokens: tokens.nullish(),
  output_tokens: tokens.nullish(),
  cache_creation_input_tokens: tokens.nullish(),
  cache_read_input_tokens: tokens.nullish(),
});

/** The content blocks a text-only turn can contain. Anything else is unexpected. */
const ALLOWED_BLOCKS = new Set(["text", "thinking", "redacted_thinking"]);

const knownEventSchema = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("message_start"),
    message: z.looseObject({ usage: usageSchema }),
  }),
  z.looseObject({
    type: z.literal("content_block_start"),
    index: z.int().min(0),
    content_block: z.looseObject({ type: z.string() }),
  }),
  z.looseObject({
    type: z.literal("content_block_delta"),
    index: z.int().min(0),
    delta: z.looseObject({ type: z.string(), text: z.string().optional() }),
  }),
  z.looseObject({ type: z.literal("content_block_stop"), index: z.int().min(0) }),
  z.looseObject({
    type: z.literal("message_delta"),
    delta: z.looseObject({ stop_reason: z.string().nullable() }),
    usage: usageSchema.optional(),
  }),
  z.looseObject({ type: z.literal("message_stop") }),
  z.looseObject({ type: z.literal("ping") }),
]);

const KNOWN_TYPES = new Set([
  "message_start",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "message_delta",
  "message_stop",
  "ping",
]);

/** The stop reasons a text-only turn may end with. */
const ACCEPTED_STOP_REASONS: ReadonlySet<string> = new Set<AssistantStopReason>([
  "end_turn",
  "max_tokens",
  "refusal",
]);

/** Billable token counts for one provider call. */
export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export const NO_USAGE: ProviderUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

function mergeUsage(
  previous: ProviderUsage,
  reported: z.infer<typeof usageSchema> | undefined,
): ProviderUsage {
  if (!reported) return previous;
  return {
    inputTokens: reported.input_tokens ?? previous.inputTokens,
    outputTokens: reported.output_tokens ?? previous.outputTokens,
    cacheCreationInputTokens:
      reported.cache_creation_input_tokens ?? previous.cacheCreationInputTokens,
    cacheReadInputTokens:
      reported.cache_read_input_tokens ?? previous.cacheReadInputTokens,
  };
}

const malformed = () => new ProviderFailure("malformed");

/**
 * Follows one provider call's stream: validates each event, checks they come
 * in order, collects the reply's text and the usage, and says when the
 * message is complete. Text deltas come back from {@link accept} for the
 * caller to forward.
 */
export class StreamReader {
  private started = false;
  private finished = false;
  private stopReason: AssistantStopReason | null = null;
  private readonly blocks = new Map<number, string>();
  private text = "";
  private currentUsage: ProviderUsage = NO_USAGE;

  /** Validates one raw event; returns the text it adds, if any. */
  accept(raw: unknown): string | null {
    const type = (raw as { type?: unknown } | null)?.type;
    if (typeof type !== "string") throw malformed();
    if (!KNOWN_TYPES.has(type)) return null;
    const parsed = knownEventSchema.safeParse(raw);
    if (!parsed.success) throw malformed();
    const event = parsed.data;
    if (this.finished) throw malformed();
    if (event.type === "ping") return null;
    if (event.type === "message_start") {
      if (this.started) throw malformed();
      this.started = true;
      this.currentUsage = mergeUsage(this.currentUsage, event.message.usage);
      return null;
    }
    if (!this.started) throw malformed();
    switch (event.type) {
      case "content_block_start":
        if (!ALLOWED_BLOCKS.has(event.content_block.type)) throw malformed();
        this.blocks.set(event.index, event.content_block.type);
        return null;
      case "content_block_delta": {
        const block = this.blocks.get(event.index);
        if (block === undefined) throw malformed();
        if (block !== "text" || event.delta.type !== "text_delta") return null;
        if (event.delta.text === undefined) throw malformed();
        this.text += event.delta.text;
        return event.delta.text;
      }
      case "content_block_stop":
        if (!this.blocks.has(event.index)) throw malformed();
        return null;
      case "message_delta": {
        const reason = event.delta.stop_reason;
        if (reason !== null) {
          if (!ACCEPTED_STOP_REASONS.has(reason))
            throw new ProviderFailure("unsupported_stop");
          this.stopReason = reason as AssistantStopReason;
        }
        this.currentUsage = mergeUsage(this.currentUsage, event.usage);
        return null;
      }
      case "message_stop":
        if (this.stopReason === null) throw malformed();
        this.finished = true;
        return null;
    }
  }

  /** Whether `message_stop` has arrived. */
  get complete(): boolean {
    return this.finished;
  }

  /** What the call has used so far, the provider's own figures. */
  get usage(): ProviderUsage {
    return this.currentUsage;
  }

  /** Whether any of the reply's text has been seen. */
  get hasText(): boolean {
    return this.text.length > 0;
  }

  /**
   * The validated reply, once complete. A turn that ended normally with no
   * text at all is not a reply.
   */
  result(): { text: string; stopReason: AssistantStopReason } {
    if (!this.finished || this.stopReason === null) throw malformed();
    if (this.stopReason === "end_turn" && this.text.trim().length === 0)
      throw malformed();
    return { text: this.text, stopReason: this.stopReason };
  }
}
