import type { CallableRequest } from "firebase-functions/v2/https";
import { describe, expect, it, vi } from "vitest";
import type { RevokeAccessStore } from "../../src/access/revokeAccess";
import { createRevokeAccessHandler } from "./revokeAccessHandler";

vi.mock("firebase-functions", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function request(
  token: Record<string, unknown> | null,
  data: unknown,
): CallableRequest<unknown> {
  return {
    auth: token ? { uid: "admin-uid", token } : undefined,
    data,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

function store(overrides: Partial<RevokeAccessStore> = {}): RevokeAccessStore {
  return {
    unlist: async () => true,
    endSessions: async () => true,
    ...overrides,
  };
}

describe("revokeAccess handler (#1147)", () => {
  it("returns what the revocation did for an admin", async () => {
    const handler = createRevokeAccessHandler(() => store());
    await expect(
      handler(
        request({ admin: true, email: "root@example.com" }, { email: "ada@example.com" }),
      ),
    ).resolves.toEqual({
      email: "ada@example.com",
      wasListed: true,
      sessionsEnded: true,
    });
  });

  it("maps each refusal to its HTTPS code", async () => {
    const unlist = vi.fn(async () => true);
    const handler = createRevokeAccessHandler(() => store({ unlist }));
    const cases: [Record<string, unknown> | null, unknown, string][] = [
      [null, { email: "ada@example.com" }, "unauthenticated"],
      [{ email: "x@example.com" }, { email: "ada@example.com" }, "permission-denied"],
      [{ admin: true }, { email: "nope" }, "invalid-argument"],
      [
        { admin: true, email: "ada@example.com" },
        { email: "ada@example.com" },
        "failed-precondition",
      ],
    ];
    for (const [token, data, code] of cases) {
      await expect(handler(request(token, data))).rejects.toMatchObject({ code });
    }
    expect(unlist).not.toHaveBeenCalled();
  });

  it("hides an unexpected failure behind a generic internal error", async () => {
    const handler = createRevokeAccessHandler(() =>
      store({
        endSessions: async () => Promise.reject(new Error("ada@example.com leaked")),
      }),
    );
    const failure = handler(request({ admin: true }, { email: "ada@example.com" }));
    await expect(failure).rejects.toMatchObject({ code: "internal" });
    await expect(failure).rejects.not.toThrow("ada@example.com");
  });
});
