import { describe, expect, it } from "vitest";
import { ASSISTANT_LIMITS, ASSISTANT_MODELS } from "./config";
import { assistantEnabled } from "./guards";
import { admitCall, quotaExceededMessage } from "./quota";
import { costMicroUsd, spendDay } from "./spend";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 5, 18, 30);

describe("the configured limits (ADR 0006)", () => {
  it("are 100 requests per rolling 24 hours, $25 a day, transcripts kept 30 days", () => {
    expect(ASSISTANT_LIMITS).toEqual({
      requestsPerWindow: 100,
      windowMs: DAY,
      dailySpendCeilingUsd: 25,
      transcriptRetentionDays: 30,
    });
  });
});

describe("admitCall", () => {
  it("allows the first 100 calls in a window and refuses the 101st", () => {
    let record = null;
    for (let i = 0; i < 100; i += 1) {
      const decision = admitCall(record, NOW + i);
      expect(decision.allowed).toBe(true);
      if (decision.allowed) record = decision.next;
    }
    expect(admitCall(record, NOW + 100)).toEqual({ allowed: false, resetsAt: NOW + DAY });
  });

  it("frees a call once the oldest leaves the window", () => {
    const calls = Array.from({ length: 100 }, (_, i) => NOW + i * 1000);
    const record = { schemaVersion: 1 as const, calls };
    expect(admitCall(record, NOW + DAY - 1).allowed).toBe(false);
    const decision = admitCall(record, NOW + DAY);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.next.calls).toHaveLength(100);
      expect(decision.remaining).toBe(0);
    }
  });

  it("prunes calls that left the window, so the record stays small", () => {
    const record = { schemaVersion: 1 as const, calls: [NOW - 2 * DAY, NOW - DAY / 2] };
    const decision = admitCall(record, NOW);
    expect(decision.allowed && decision.next.calls).toEqual([NOW - DAY / 2, NOW]);
  });

  it("keeps and counts a call stamped ahead of this clock", () => {
    // Another instance's clock ran a minute fast; its calls still count.
    const ahead = Array.from({ length: 99 }, () => NOW + 60_000);
    const record = { schemaVersion: 1 as const, calls: [NOW - 1_000, ...ahead] };
    expect(admitCall(record, NOW)).toEqual({
      allowed: false,
      resetsAt: NOW - 1_000 + DAY,
    });

    const decision = admitCall({ schemaVersion: 1, calls: [NOW + 60_000] }, NOW);
    expect(decision.allowed && decision.next.calls).toEqual([NOW, NOW + 60_000]);
    expect(decision.allowed && decision.remaining).toBe(98);
  });
});

describe("quotaExceededMessage", () => {
  it("says requests, not messages, and names when the window resets", () => {
    const message = quotaExceededMessage(Date.UTC(2026, 9, 6, 9, 15));
    expect(message).toContain("100 assistant requests");
    expect(message).not.toContain("messages");
    expect(message).toContain("2026-10-06 09:15 UTC");
  });
});

describe("spend", () => {
  it("prices every kind of token at the model's rate, in micro-dollars", () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 1_000,
    };
    // Sonnet 5: $2 in, $10 out, $2.50 cache write, $0.20 cache read per MTok.
    expect(costMicroUsd(ASSISTANT_MODELS["claude-sonnet-5"], usage)).toBe(
      2_000 + 5_000 + 500 + 200,
    );
  });

  it("buckets spend by UTC day", () => {
    expect(spendDay(Date.UTC(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(spendDay(Date.UTC(2026, 9, 6, 0, 0))).toBe("2026-10-06");
  });
});

describe("the kill switch", () => {
  it("is on unless the document says enabled: false", () => {
    expect(assistantEnabled(null)).toBe(true);
    expect(assistantEnabled({})).toBe(true);
    expect(assistantEnabled({ enabled: true })).toBe(true);
    expect(assistantEnabled({ enabled: false })).toBe(false);
  });
});
