import { describe, expect, it } from "vitest";
import {
  parseCreatedBefore,
  planGrandfathering,
  type SeedCandidate,
} from "./grandfather";

const DEPLOYED = Date.parse("2026-10-01T12:00:00Z");

function account(
  email: string | undefined,
  createdAt = DEPLOYED - 1000,
  hasProvider = true,
) {
  return { email, hasProvider, createdAt } satisfies SeedCandidate;
}

describe("planGrandfathering", () => {
  it("before the gate has refused anyone, seeds every account with a provider", () => {
    const plan = planGrandfathering({
      accounts: [
        account("Ada@Example.com"),
        account(undefined, DEPLOYED - 1000, false), // a guest
        account("guest@example.com", DEPLOYED - 1000, false),
        account("ada@example.com"),
      ],
      refusedEmails: [],
    });
    expect(plan).toEqual({
      ok: true,
      emails: ["ada@example.com"],
      skippedRefused: [],
      skippedAfterCutoff: [],
    });
  });

  it("refuses to run once the gate has refused anyone and no cutoff is given", () => {
    // A refused sign-in still creates the account, so without this the seed
    // would grandfather the person the gate just turned away.
    const plan = planGrandfathering({
      accounts: [
        account("ada@example.com"),
        account("stranger@example.test", DEPLOYED + 5000),
      ],
      refusedEmails: ["stranger@example.test"],
    });
    expect(plan).toEqual({ ok: false, reason: "gate-has-refused", refusedCount: 1 });
  });

  it("never seeds a refused address, even one whose account predates the cutoff", () => {
    const plan = planGrandfathering({
      accounts: [
        account("ada@example.com"),
        account("Stranger@Example.test", DEPLOYED - 1000),
      ],
      refusedEmails: ["stranger@example.test"],
      createdBefore: DEPLOYED,
    });
    expect(plan).toEqual({
      ok: true,
      emails: ["ada@example.com"],
      skippedRefused: ["stranger@example.test"],
      skippedAfterCutoff: [],
    });
  });

  it("with a cutoff, leaves out every account created at or after it", () => {
    // An account created after enforcement came through the gate; one whose
    // refusal was never recorded is still kept off by the cutoff.
    const plan = planGrandfathering({
      accounts: [
        account("ada@example.com", DEPLOYED - 1),
        account("unrecorded@example.test", DEPLOYED),
        account("later@example.test", DEPLOYED + 60_000),
      ],
      refusedEmails: [],
      createdBefore: DEPLOYED,
    });
    expect(plan).toEqual({
      ok: true,
      emails: ["ada@example.com"],
      skippedRefused: [],
      skippedAfterCutoff: ["unrecorded@example.test", "later@example.test"],
    });
  });
});

describe("parseCreatedBefore", () => {
  it("is absent without the flag", () => {
    expect(parseCreatedBefore([])).toEqual({ ok: true });
  });

  it("reads an ISO timestamp", () => {
    expect(parseCreatedBefore(["--before", "2026-10-01T12:00:00Z"])).toEqual({
      ok: true,
      createdBefore: DEPLOYED,
    });
  });

  it("is an error, never 'no cutoff', when the value is missing or not a date", () => {
    expect(parseCreatedBefore(["--before"]).ok).toBe(false);
    expect(parseCreatedBefore(["--before", "last tuesday"]).ok).toBe(false);
  });
});
