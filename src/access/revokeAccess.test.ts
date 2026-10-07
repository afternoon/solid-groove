import { describe, expect, it, vi } from "vitest";
import {
  parseRevokeAccessRequest,
  type RevokeAccessStore,
  revokeAccess,
} from "./revokeAccess";

function store(seed: { listed?: string[]; accounts?: string[] } = {}) {
  const listed = new Set(seed.listed ?? []);
  const accounts = new Set(seed.accounts ?? []);
  const calls: string[] = [];
  const fake: RevokeAccessStore = {
    async unlist(email) {
      calls.push(`unlist ${email}`);
      return listed.delete(email);
    },
    async endSessions(email) {
      calls.push(`endSessions ${email}`);
      return accounts.has(email);
    },
  };
  return { fake, listed, calls };
}

const admin = { admin: true, email: "root@example.com" };

describe("revokeAccess (#1147)", () => {
  it("takes a listed address off the list and ends its account's sessions, in that order", async () => {
    const { fake, listed, calls } = store({
      listed: ["ada@example.com"],
      accounts: ["ada@example.com"],
    });
    await expect(
      revokeAccess(fake, admin, { email: " Ada@Example.com " }),
    ).resolves.toEqual({
      email: "ada@example.com",
      wasListed: true,
      sessionsEnded: true,
    });
    expect(listed.has("ada@example.com")).toBe(false);
    expect(calls).toEqual(["unlist ada@example.com", "endSessions ada@example.com"]);
  });

  it("reports an address that never signed in as having no sessions to end", async () => {
    const { fake } = store({ listed: ["ada@example.com"] });
    await expect(
      revokeAccess(fake, admin, { email: "ada@example.com" }),
    ).resolves.toEqual({
      email: "ada@example.com",
      wasListed: true,
      sessionsEnded: false,
    });
  });

  it("still ends the sessions of an address removed from the list earlier", async () => {
    const { fake, calls } = store({ accounts: ["ada@example.com"] });
    await expect(
      revokeAccess(fake, admin, { email: "ada@example.com" }),
    ).resolves.toEqual({
      email: "ada@example.com",
      wasListed: false,
      sessionsEnded: true,
    });
    expect(calls).toHaveLength(2);
  });

  it("refuses a signed-out caller, a non-admin, a bad request and the admin's own address without writing", async () => {
    const { fake, calls } = store({ listed: ["ada@example.com", "root@example.com"] });
    const cases: [Parameters<typeof revokeAccess>[1], unknown, string][] = [
      [null, { email: "ada@example.com" }, "unauthenticated"],
      [
        { admin: false, email: "x@example.com" },
        { email: "ada@example.com" },
        "not_admin",
      ],
      [admin, { email: "not an address" }, "invalid_request"],
      [admin, "ada@example.com", "invalid_request"],
      [admin, { email: "Root@example.com" }, "self"],
    ];
    for (const [caller, input, reason] of cases) {
      await expect(revokeAccess(fake, caller, input)).rejects.toMatchObject({
        name: "RevokeAccessRefused",
        reason,
      });
    }
    expect(calls).toEqual([]);
  });

  it("lets the failure of either step through, so the caller can retry", async () => {
    const { fake } = store({ listed: ["ada@example.com"] });
    fake.endSessions = vi.fn().mockRejectedValue(new Error("auth down"));
    await expect(revokeAccess(fake, admin, { email: "ada@example.com" })).rejects.toThrow(
      "auth down",
    );
  });

  it("parses only an object with one valid address", () => {
    expect(parseRevokeAccessRequest({ email: "Ada@Example.com" })).toBe(
      "ada@example.com",
    );
    expect(parseRevokeAccessRequest({ email: "nope" })).toBeNull();
    expect(parseRevokeAccessRequest({ email: 3 })).toBeNull();
    expect(parseRevokeAccessRequest(null)).toBeNull();
    expect(parseRevokeAccessRequest("ada@example.com")).toBeNull();
  });
});
