/**
 * The organisation-wide spend ceiling (ADR 0006 decision 6): an automatic
 * cut-off once a UTC day's provider calls have cost $25.
 *
 * The total is an estimate from the provider's own token counts and the
 * configured prices, kept in whole micro-dollars so concurrent increments
 * add exactly. It is checked before every provider call and added to after
 * every one, a failed one included.
 */
import type { AssistantModelProfile } from "./config";
import type { ProviderUsage } from "./streamEvents";

/** One day's running total: `assistantSpend/{day}`. */
export interface AssistantSpendRecord {
  readonly schemaVersion: 1;
  /** The UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly microUsd: number;
}

/** The UTC day `now` falls in, `YYYY-MM-DD`. */
export function spendDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** What one provider call cost, in micro-dollars, rounded up. */
export function costMicroUsd(model: AssistantModelProfile, usage: ProviderUsage): number {
  const price = model.priceUsdPerMillionTokens;
  // Dollars per million tokens is micro-dollars per token.
  const micro =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheCreationInputTokens * price.cacheWrite +
    usage.cacheReadInputTokens * price.cacheRead;
  return Math.ceil(micro);
}

export function usdToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}
