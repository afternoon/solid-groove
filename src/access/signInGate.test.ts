import { describe, expect, it } from "vitest";
import type { SignInAttempt } from "./allowlist";
import { gateSignIn, nextAttempt, type SignInGateStore } from "./signInGate";

/** The gate's store over two maps, as the function's is over Firestore. */
function memoryStore(listed: string[]) {
  const allowlist = new Set(listed);
  const attempts = new Map<string, SignInAttempt>();
  const store: SignInGateStore = {
    async isListed(email) {
      return allowlist.has(email);
    },
    async recordAttempt(email, update) {
      attempts.set(email, update(attempts.get(email) ?? null));
    },
  };
  return { store, attempts };
}

/** A user whose provider verified the address. */
function verified(email: string) {
  return { email, emailVerified: true };
}

describe("gateSignIn", () => {
  it("lets a listed address in and records nothing", async () => {
    const { store, attempts } = memoryStore(["ada@example.com"]);
    expect(
      await gateSignIn(store, { email: "ada@example.com", emailVerified: true }, 10),
    ).toEqual({
      allowed: true,
    });
    expect(attempts.size).toBe(0);
  });

  it("compares the normalised address, so case and spaces do not lock anyone out", async () => {
    const { store } = memoryStore(["ada@example.com"]);
    expect(
      await gateSignIn(store, { email: " Ada@Example.COM", emailVerified: true }, 10),
    ).toEqual({
      allowed: true,
    });
  });

  it("refuses an unlisted address and records the attempt under its normalised address", async () => {
    const { store, attempts } = memoryStore(["ada@example.com"]);
    expect(
      await gateSignIn(store, { email: "Grace@Example.com", emailVerified: true }, 10),
    ).toEqual({
      allowed: false,
      reason: "not_listed",
    });
    expect(attempts.get("grace@example.com")).toEqual({
      email: "grace@example.com",
      firstAttemptAt: 10,
      lastAttemptAt: 10,
      count: 1,
    });
  });

  it("folds repeat attempts into one record, keeping when they started", async () => {
    const { store, attempts } = memoryStore([]);
    await gateSignIn(store, verified("grace@example.com"), 10);
    await gateSignIn(store, verified("grace@example.com"), 25);
    expect(attempts.get("grace@example.com")).toEqual({
      email: "grace@example.com",
      firstAttemptAt: 10,
      lastAttemptAt: 25,
      count: 2,
    });
  });

  it("lets a Google sign-in in on Google's word for the address", async () => {
    const { store } = memoryStore(["ada@example.com"]);
    expect(
      await gateSignIn(store, { email: "ada@example.com", providerId: "google.com" }, 10),
    ).toEqual({ allowed: true });
  });

  it("refuses an unverified address even when it is listed, and records nothing", async () => {
    const { store, attempts } = memoryStore(["ada@example.com"]);
    for (const user of [
      { email: "ada@example.com" },
      { email: "ada@example.com", emailVerified: false, providerId: "password" },
      { email: "grace@example.com", emailVerified: false },
    ]) {
      expect(await gateSignIn(store, user, 10)).toEqual({
        allowed: false,
        reason: "unverified",
      });
    }
    expect(attempts.size).toBe(0);
  });

  it("refuses a sign-in with no address without recording it", async () => {
    const { store, attempts } = memoryStore([]);
    expect(await gateSignIn(store, { email: null }, 10)).toEqual({
      allowed: false,
      reason: "no_email",
    });
    expect(await gateSignIn(store, {}, 10)).toEqual({
      allowed: false,
      reason: "no_email",
    });
    expect(attempts.size).toBe(0);
  });
});

describe("nextAttempt", () => {
  it("starts a record on the first refusal", () => {
    expect(nextAttempt(null, "a@example.com", 5)).toEqual({
      email: "a@example.com",
      firstAttemptAt: 5,
      lastAttemptAt: 5,
      count: 1,
    });
  });
});
