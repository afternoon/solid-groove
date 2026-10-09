/**
 * The Linear → GitHub relay: a Cloudflare Worker that starts the Board
 * workflow the moment a card moves, rather than at its next scheduled poll.
 *
 * Linear posts a webhook for every issue and comment change in team GRV. The
 * Worker checks Linear's signature, keeps only the events `board.mjs poll`
 * acts on (a card entering Ready, Approved or In Progress, a card reaching QA
 * or Done, which can free the cards it blocks, a new card, a comment that
 * mentions @claude) and asks GitHub to run `board.yml` on main. The poll then
 * reads the board itself, so the Worker passes nothing on and makes no
 * decisions: a dropped or duplicated event costs at most one idle poll, and a
 * burst of events collapses into one run through `board.yml`'s concurrency
 * group.
 *
 * It is also the backstop: a Cloudflare cron (`wrangler.toml`) starts a poll
 * every 15 minutes, because GitHub runs `board.yml`'s own schedule late or not
 * at all for hours. That schedule stays, for when the relay itself is down.
 *
 * Deploy and secrets: docs/linear.md, "The relay". `relay.yml` redeploys it
 * when this directory changes on main.
 */

/**
 * Columns whose arrival `board.mjs poll` acts on. QA and Done count because a
 * blocker counts as merged once it reaches QA, so a card waiting on it in
 * Ready can start.
 */
const ACTIONABLE_STATES = new Set(["ready", "approved", "in progress", "qa", "done"]);

/** How old a delivery may be before it is treated as a replay. */
const MAX_AGE_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

/** Lowercase hex HMAC-SHA256 of `body` under `secret`. */
export async function sign(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether `signature` is Linear's for `body`, compared in constant time. */
export async function verify(secret, body, signature) {
  if (!secret || typeof signature !== "string") return false;
  const expected = await sign(secret, body);
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/**
 * Why this event should start a poll, or `null` when it should not. Fails
 * open on an issue whose new column the payload does not name: one idle poll
 * is cheaper than a card left waiting.
 */
export function reasonToPoll(event) {
  if (event?.type === "Issue") {
    if (event.action === "create") return "issue created";
    if (
      event.action !== "update" ||
      !event.updatedFrom ||
      !("stateId" in event.updatedFrom)
    )
      return null;
    const state = event.data?.state?.name;
    if (typeof state !== "string") return "issue moved";
    return ACTIONABLE_STATES.has(state.toLowerCase()) ? `issue moved to ${state}` : null;
  }
  if (event?.type === "Comment" && event.action === "create") {
    return /@claude\b/i.test(event.data?.body ?? "") ? "comment mentions @claude" : null;
  }
  return null;
}

/** Asks GitHub to run the Board workflow. Resolves to GitHub's response. */
export function dispatch(env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPO ?? "trygroove/groove";
  const workflow = env.WORKFLOW ?? "board.yml";
  return fetchImpl(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "groove-linear-relay",
      },
      body: JSON.stringify({ ref: env.REF ?? "main" }),
    },
  );
}

/** The Worker's request handler, with its clock and fetch injectable for tests. */
export async function handle(request, env, { now = Date.now, fetchImpl = fetch } = {}) {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await request.text();
  if (
    !(await verify(
      env.LINEAR_WEBHOOK_SECRET,
      body,
      request.headers.get("linear-signature"),
    ))
  )
    return new Response("bad signature", { status: 401 });

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const sentAt = Number(event.webhookTimestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now() - sentAt) > MAX_AGE_MS)
    return new Response("stale", { status: 401 });

  const reason = reasonToPoll(event);
  if (!reason) return new Response("ignored", { status: 200 });

  const res = await dispatch(env, fetchImpl);
  if (res.status === 204) return new Response(`dispatched: ${reason}`, { status: 202 });
  // A non-2xx answer makes Linear retry the delivery later.
  console.error(`dispatch failed: ${res.status} ${await res.text()}`);
  return new Response("dispatch failed", { status: 502 });
}

/** The cron backstop: starts a poll whatever the board looks like. */
export async function poll(env, fetchImpl = fetch) {
  const res = await dispatch(env, fetchImpl);
  if (res.status === 204) return;
  // Throwing marks the cron run failed in the Worker's logs.
  throw new Error(`scheduled dispatch failed: ${res.status} ${await res.text()}`);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (_controller, env, ctx) => ctx.waitUntil(poll(env)),
};
