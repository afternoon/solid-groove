import { describe, expect, it, vi } from "vitest";
import { handle, reasonToPoll, sign, verify } from "./worker.mjs";

const SECRET = "whsec_test";
const NOW = 1_760_000_000_000;
const env = { LINEAR_WEBHOOK_SECRET: SECRET, GITHUB_TOKEN: "ghp_test" };

const moved = (name) => ({
  type: "Issue",
  action: "update",
  data: { identifier: "GRV-1", state: { name } },
  updatedFrom: { stateId: "old" },
});

async function deliver(event, { secret = SECRET, at = NOW, status = 204 } = {}) {
  const body = JSON.stringify({ webhookTimestamp: at, ...event });
  const request = new Request("https://relay.example/", {
    method: "POST",
    headers: { "linear-signature": await sign(secret, body) },
    body,
  });
  const fetchImpl = vi.fn(async () => new Response(null, { status }));
  const res = await handle(request, env, { now: () => NOW, fetchImpl });
  return { res, fetchImpl };
}

describe("verify", () => {
  it("accepts Linear's signature and rejects any other", async () => {
    const body = '{"a":1}';
    expect(await verify(SECRET, body, await sign(SECRET, body))).toBe(true);
    expect(await verify(SECRET, body, await sign("other", body))).toBe(false);
    expect(await verify(SECRET, `${body} `, await sign(SECRET, body))).toBe(false);
    expect(await verify(SECRET, body, null)).toBe(false);
    expect(await verify(undefined, body, await sign(SECRET, body))).toBe(false);
  });
});

describe("reasonToPoll", () => {
  it("polls when a card enters a column the board acts on", () => {
    for (const name of ["Ready", "Approved", "In Progress"])
      expect(reasonToPoll(moved(name))).toMatch(name);
  });

  it("ignores moves into columns the board does not act on", () => {
    for (const name of ["Backlog", "QA", "Done", "Blocked", "Ready For Review"])
      expect(reasonToPoll(moved(name))).toBeNull();
  });

  it("ignores an issue edit that is not a move", () => {
    expect(reasonToPoll({ ...moved("Ready"), updatedFrom: { title: "old" } })).toBeNull();
  });

  it("polls on a move whose column the payload does not name", () => {
    expect(reasonToPoll({ ...moved("Ready"), data: {} })).toBe("issue moved");
  });

  it("polls on a new card, for the milestone and a card created in Ready", () => {
    expect(reasonToPoll({ type: "Issue", action: "create", data: {} })).toBe(
      "issue created",
    );
  });

  it("polls on a new comment only when it mentions @claude", () => {
    const comment = (body) => ({ type: "Comment", action: "create", data: { body } });
    expect(reasonToPoll(comment("@claude please fix the copy"))).toMatch("@claude");
    expect(reasonToPoll(comment("Looks good"))).toBeNull();
    expect(reasonToPoll({ ...comment("@claude"), action: "update" })).toBeNull();
  });

  it("ignores every other resource", () => {
    expect(reasonToPoll({ type: "Project", action: "update" })).toBeNull();
    expect(reasonToPoll(undefined)).toBeNull();
  });
});

describe("handle", () => {
  it("dispatches board.yml on main for a card moved to Ready", async () => {
    const { res, fetchImpl } = await deliver(moved("Ready"));
    expect(res.status).toBe(202);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/trygroove/groove/actions/workflows/board.yml/dispatches",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ghp_test");
    expect(JSON.parse(init.body)).toEqual({ ref: "main" });
  });

  it("acknowledges an event it ignores without calling GitHub", async () => {
    const { res, fetchImpl } = await deliver(moved("Done"));
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a forged delivery", async () => {
    const { res, fetchImpl } = await deliver(moved("Ready"), { secret: "forged" });
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a replayed delivery", async () => {
    const { res, fetchImpl } = await deliver(moved("Ready"), {
      at: NOW - 10 * 60 * 1000,
    });
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails the delivery when GitHub refuses, so Linear retries it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await deliver(moved("Ready"), { status: 403 });
    expect(res.status).toBe(502);
  });

  it("accepts only POST", async () => {
    const res = await handle(new Request("https://relay.example/"), env);
    expect(res.status).toBe(405);
  });
});
