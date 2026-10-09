import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";
import { createInMemoryTranscriptStore } from "../../src/assistant/inMemoryTranscriptStore";
import { ASSISTANT_DISCLOSURE_VERSION } from "../../src/assistant/transcripts";
import { createRetentionHandler } from "./retentionHandler";

function callable(uid: string | null, data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: uid
      ? { uid, token: { firebase: { sign_in_provider: "google.com" } } }
      : undefined,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>;
}

async function httpsErrorOf(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error("expected an HttpsError");
}

describe("createRetentionHandler", () => {
  it("reads and stores the caller's answer", async () => {
    const store = createInMemoryTranscriptStore();
    const handle = createRetentionHandler(
      () => store,
      () => 42,
    );
    expect(await handle(callable("u", { op: "get" }))).toMatchObject({
      preference: null,
    });
    expect(
      await handle(
        callable("u", {
          op: "set",
          retain: false,
          disclosureVersion: ASSISTANT_DISCLOSURE_VERSION,
        }),
      ),
    ).toMatchObject({ preference: { retain: false, answeredAt: 42 } });
  });

  it("refuses no account as unauthenticated", async () => {
    const handle = createRetentionHandler(() => createInMemoryTranscriptStore());
    const error = await httpsErrorOf(handle(callable(null, { op: "get" })));
    expect(error.code).toBe("unauthenticated");
  });

  it("refuses a malformed request, and an answer to an older disclosure", async () => {
    const handle = createRetentionHandler(() => createInMemoryTranscriptStore());
    expect((await httpsErrorOf(handle(callable("u", { op: "drop" })))).code).toBe(
      "invalid-argument",
    );
    const stale = await httpsErrorOf(
      handle(
        callable("u", {
          op: "set",
          retain: true,
          disclosureVersion: ASSISTANT_DISCLOSURE_VERSION + 1,
        }),
      ),
    );
    expect(stale.code).toBe("failed-precondition");
    expect(stale.details).toEqual({ code: "stale_disclosure" });
  });
});
