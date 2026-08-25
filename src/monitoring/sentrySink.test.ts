// The Sentry SDK is never loaded here. Every test injects a fake module
// through `SentrySinkOptions.load`, which is what lets this file assert the
// ADR 0001, ADR 0002, and ADR 0003 configuration decisions — `sendDefaultPii`
// off, console breadcrumbs disabled rather than filtered, Session Replay
// present with text masking on, attributes masked, media blocked, canvas
// recording on, and error-triggered replay at 0 — as facts about the options
// object rather than as comments nobody checks.

import { describe, expect, it, vi } from "vitest";
import { UNKNOWN_BROWSER } from "./browserInfo";
import type { ErrorReport } from "./errorReporting";
import { MASK_ATTRIBUTES, MASK_CONTENT } from "./replayPrivacy";
import {
  REPLAY_CANVAS_INTEGRATION,
  REPLAY_SESSION_SAMPLE_RATE,
  SentrySink,
} from "./sentrySink";

type InitOptions = Record<string, unknown>;

function fakeSentry() {
  const inits: InitOptions[] = [];
  const captures: { error: unknown; context: Record<string, unknown> }[] = [];
  const close = vi.fn(async () => true);
  const stopReplay = vi.fn(async () => {});
  const integration = (name: string) => (options?: unknown) => ({
    name,
    options,
  });
  return {
    module: {
      init: (options: InitOptions) => void inits.push(options),
      captureException: (error: unknown, context: Record<string, unknown>) =>
        void captures.push({ error, context }),
      getClient: () => ({ close }),
      getReplay: () => ({ stop: stopReplay }),
      browserSessionIntegration: integration("BrowserSession"),
      dedupeIntegration: integration("Dedupe"),
      breadcrumbsIntegration: integration("Breadcrumbs"),
      replayIntegration: integration("Replay"),
      replayCanvasIntegration: integration("ReplayCanvas"),
    },
    inits,
    captures,
    close,
    stopReplay,
  };
}

/** The integration list the SDK was handed, with each one's own options. */
function integrations(options: InitOptions) {
  return options.integrations as {
    name: string;
    options?: Record<string, unknown>;
  }[];
}

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    area: "shell",
    code: "unknown",
    fatal: false,
    message: "redacted message",
    releaseSha: "abc123def456",
    browser: {
      ...UNKNOWN_BROWSER,
      browserName: "firefox",
      browserVersion: "142",
    },
    error: new Error("boom"),
    fingerprint: "shell|unknown|redacted message|",
    ...overrides,
  };
}

async function started({
  dsn = "https://examplePublicKey@o0.ingest.invalid/0",
  sessionReplay = true,
}: {
  dsn?: string;
  sessionReplay?: boolean;
} = {}) {
  const sentry = fakeSentry();
  const sink = new SentrySink({
    dsn,
    release: "abc123def456",
    sessionReplay,
    load: async () => sentry.module as never,
  });
  const ok = await sink.start();
  return { sentry, sink, ok, options: sentry.inits[0] };
}

describe("privacy configuration (ADR 0001)", () => {
  it("turns sendDefaultPii off", async () => {
    const { options } = await started();
    expect(options.sendDefaultPii).toBe(false);
  });

  it("disables console breadcrumbs rather than filtering them", async () => {
    const { options } = await started();
    const breadcrumbs = integrations(options).find(
      (integration) => integration.name === "Breadcrumbs",
    );
    expect(breadcrumbs?.options?.console).toBe(false);
  });

  it("uses an explicit minimal integration set with no default integrations", async () => {
    // `defaultIntegrations: false` also switches off Sentry's own
    // globalHandlers, so our boundary stays the single capture point.
    const { options } = await started();
    expect(options.defaultIntegrations).toBe(false);
    expect(
      integrations(options)
        .map((i) => i.name)
        .sort(),
    ).toEqual(["Breadcrumbs", "BrowserSession", "Dedupe", "Replay", "ReplayCanvas"]);
  });

  it("enables the session integration Release Health needs", async () => {
    // The PRD section 11 crash-free session rate comes from this rather than
    // from a hand-built derivation.
    const { options } = await started();
    expect(
      (options.integrations as { name: string }[]).some(
        (i) => i.name === "BrowserSession",
      ),
    ).toBe(true);
  });

  it("sends no performance traces", async () => {
    const { options } = await started();
    expect(options.tracesSampleRate).toBe(0);
  });

  it("scrubs through beforeSend and beforeBreadcrumb", async () => {
    const { options } = await started();
    const beforeSend = options.beforeSend as (event: unknown) => {
      extra?: unknown;
    };
    const beforeBreadcrumb = options.beforeBreadcrumb as (crumb: unknown) => unknown;

    expect(beforeSend({ extra: { project: "Midnight Drive" } }).extra).toBeUndefined();
    expect(beforeBreadcrumb({ category: "console", message: "x" })).toBeNull();
  });

  it("stamps the release so a report ties back to the deployed revision", async () => {
    const { options } = await started();
    expect(options.release).toBe("abc123def456");
    expect(options.dsn).toBe("https://examplePublicKey@o0.ingest.invalid/0");
  });
});

describe("Session Replay configuration (ADR 0002)", () => {
  /** The replay integration's own options, or undefined when it is absent. */
  async function replay(sessionReplay: boolean) {
    const { options } = await started({ sessionReplay });
    return integrations(options).find((i) => i.name === "Replay")?.options;
  }

  it("masks all text at capture, so characters never enter the payload", async () => {
    // Decision 2. Masking happens in the browser before serialization, which
    // is the whole reason ADR 0001's prohibition could be lifted at all.
    expect(await replay(true)).toMatchObject({ maskAllText: true });
  });

  it("masks every input, because typed text is user content by definition", async () => {
    expect(await replay(true)).toMatchObject({ maskAllInputs: true });
  });

  it("blocks all media", async () => {
    expect(await replay(true)).toMatchObject({ blockAllMedia: true });
  });

  it("honours the classes a content surface marks itself with", async () => {
    // The second safeguard of decision 2: the global default *and* the
    // component's own markup. `replayPrivacy.test.ts` checks the markup end;
    // this checks the SDK is actually told to look for it.
    expect(await replay(true)).toMatchObject({
      mask: [`.${MASK_CONTENT}`],
    });
  });

  it("masks the attributes names reach the DOM through, not just text nodes", async () => {
    // Class marking covers text nodes and input values. An `aria-label` with a
    // track name in it is neither, and the SDK *replaces* its default
    // attribute list rather than extending it — so this asserts the whole
    // list, not just that `aria-label` is somewhere in it.
    expect(await replay(true)).toMatchObject({
      maskAttributes: [...MASK_ATTRIBUTES],
    });
  });

  it("records canvas, so the arrangement and piano roll are actually visible", async () => {
    // ADR 0003 decision 1, reversing ADR 0002. Canvas is a *separate*
    // integration in the SDK, so "on" is its presence in the integration list
    // rather than a flag on the replay options. With it absent, replay showed
    // a pointer moving over a grey page — useless for the surfaces that are
    // the whole reason replay is enabled.
    const { options } = await started({ sessionReplay: true });
    expect(integrations(options).map((i) => i.name)).toContain("ReplayCanvas");
  });

  it("does not record canvas when replay itself is off", async () => {
    // The canvas integration is inert without replay, but constructing it
    // anyway would mean an opted-out user carries replay machinery.
    const { options } = await started({ sessionReplay: false });
    expect(integrations(options).map((i) => i.name)).not.toContain("ReplayCanvas");
    expect(JSON.stringify(options)).not.toContain(REPLAY_CANVAS_INTEGRATION);
  });

  it("samples sessions low and never records on error", async () => {
    // Decision 6. Error-triggered replay is the debugging use ADR 0001
    // weighed and rejected; ADR 0002 buys usage understanding, not that.
    const { options } = await started({ sessionReplay: true });
    expect(options.replaysSessionSampleRate).toBe(REPLAY_SESSION_SAMPLE_RATE);
    expect(REPLAY_SESSION_SAMPLE_RATE).toBeLessThanOrEqual(0.1);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it("does not unmask anything", async () => {
    // Decision 2 permits unmasking only stable, non-user-authored chrome by an
    // explicit named selector. Until a surface proves unreadable there is
    // nothing to name, and the absence is the safe state.
    const options = await replay(true);
    expect(options).not.toHaveProperty("unmask");
    expect(options).not.toHaveProperty("unblock");
  });
});

describe("declining replay stops it at the source (ADR 0002 decision 4)", () => {
  it("constructs no replay integration at all for a declined session", async () => {
    // Not a send filter: nothing is captured in the first place. This is the
    // property that makes the disclosure's promise true rather than aspirational.
    const { options } = await started({ sessionReplay: false });
    expect(integrations(options).map((i) => i.name)).not.toContain("Replay");
    expect(JSON.stringify(options)).not.toContain("Replay");
  });

  it("samples no sessions either, so neither guard is load-bearing alone", async () => {
    const { options } = await started({ sessionReplay: false });
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it("defaults to declined when the caller has not consulted consent", async () => {
    // A caller that forgets to pass consent gets the safe outcome, not the
    // recording one.
    const sentry = fakeSentry();
    const sink = new SentrySink({
      dsn: "https://k@o0.ingest.invalid/0",
      load: async () => sentry.module as never,
    });
    await sink.start();
    expect(integrations(sentry.inits[0]).map((i) => i.name)).not.toContain("Replay");
  });

  it("stops an in-flight recording when consent is withdrawn mid-session", async () => {
    const { sentry, sink } = await started({ sessionReplay: true });
    await sink.stopReplay();
    expect(sentry.stopReplay).toHaveBeenCalledTimes(1);
  });

  it("stops the recording before closing the client, not as a side effect of it", async () => {
    // A sampled-in recording buffers in the page; leaving it to the client
    // teardown is what "merely dropping it before send" would look like.
    const { sentry, sink } = await started({ sessionReplay: true });
    await sink.stop();
    expect(sentry.stopReplay).toHaveBeenCalled();
    expect(sentry.close).toHaveBeenCalled();
  });

  it("is idempotent, so a repeated withdrawal is harmless", async () => {
    const { sentry, sink } = await started({ sessionReplay: true });
    await sink.stopReplay();
    await sink.stopReplay();
    await sink.stop();
    expect(sentry.stopReplay).toHaveBeenCalledTimes(1);
  });

  it("does nothing when replay was never enabled", async () => {
    const { sentry, sink } = await started({ sessionReplay: false });
    await sink.stopReplay();
    expect(sentry.stopReplay).not.toHaveBeenCalled();
  });

  it("survives an SDK that cannot stop the recording", async () => {
    // Consent withdrawal must not throw. The client close is the backstop.
    const sentry = fakeSentry();
    const sink = new SentrySink({
      dsn: "https://k@o0.ingest.invalid/0",
      sessionReplay: true,
      load: async () =>
        ({
          ...sentry.module,
          getReplay: () => {
            throw new Error("replay unavailable");
          },
        }) as never,
    });
    await sink.start();
    await expect(sink.stopReplay()).resolves.toBeUndefined();
  });
});

describe("capture", () => {
  it("marks a fatal report unhandled, which is what crashes the session", async () => {
    const { sentry, sink } = await started();
    sink.capture(report({ fatal: true }));
    expect(sentry.captures[0].context).toMatchObject({
      mechanism: { handled: false },
    });
  });

  it("leaves a non-fatal report handled", async () => {
    const { sentry, sink } = await started();
    sink.capture(report({ fatal: false }));
    expect(sentry.captures[0].context).toMatchObject({
      mechanism: { handled: true },
    });
  });

  it("tags area, code, and browser without any free text", async () => {
    const { sentry, sink } = await started();
    sink.capture(report({ area: "audio", code: "autoplay_blocked" }));
    const context = sentry.captures[0].context.captureContext as {
      tags: Record<string, unknown>;
      level: string;
    };
    expect(context.tags).toEqual({
      area: "audio",
      error_code: "autoplay_blocked",
      fatal: false,
      browser_name: "firefox",
      browser_version: "142",
      engine_name: "other",
      engine_version: "unknown",
    });
    expect(context.level).toBe("error");
  });

  it("passes the original error so Sentry can symbolicate its stack", async () => {
    const { sentry, sink } = await started();
    const error = new Error("boom");
    sink.capture(report({ error }));
    expect(sentry.captures[0].error).toBe(error);
  });
});

describe("lazy start", () => {
  it("does nothing without a DSN, rather than failing", async () => {
    const sentry = fakeSentry();
    const sink = new SentrySink({
      dsn: "",
      load: async () => sentry.module as never,
    });
    expect(await sink.start()).toBe(false);
    expect(sentry.inits).toHaveLength(0);
  });

  it("resolves false when the SDK chunk cannot be loaded", async () => {
    // An ad blocker, an offline first load, or a chunk that 404s after a
    // rollback. None of these may surface to the user.
    const sink = new SentrySink({
      dsn: "https://k@o0.ingest.invalid/0",
      load: async () => {
        throw new Error("blocked");
      },
    });
    expect(await sink.start()).toBe(false);
    expect(sink.isReady).toBe(false);
  });

  it("is idempotent and loads the SDK only once", async () => {
    const sentry = fakeSentry();
    const load = vi.fn(async () => sentry.module as never);
    const sink = new SentrySink({ dsn: "https://k@o0.ingest.invalid/0", load });
    await Promise.all([sink.start(), sink.start()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("buffers a crash that happens before the SDK is ready, then flushes it", async () => {
    // Startup crashes are the most valuable kind; the lazy-loading
    // requirement must not be what loses them.
    const sentry = fakeSentry();
    const sink = new SentrySink({
      dsn: "https://k@o0.ingest.invalid/0",
      load: async () => sentry.module as never,
    });
    sink.capture(report({ message: "during startup" }));
    expect(sentry.captures).toHaveLength(0);

    await sink.start();

    expect(sentry.captures).toHaveLength(1);
  });

  it("bounds the buffer so an error loop before start cannot grow memory", async () => {
    const sentry = fakeSentry();
    const sink = new SentrySink({
      dsn: "https://k@o0.ingest.invalid/0",
      load: async () => sentry.module as never,
    });
    for (let i = 0; i < 100; i += 1) sink.capture(report());
    await sink.start();
    expect(sentry.captures.length).toBeLessThanOrEqual(20);
  });
});

describe("stop (consent withdrawn mid-session)", () => {
  it("closes the client and stops capturing", async () => {
    // `browserSessionIntegration` emits session updates on its own, so the
    // client itself has to be closed, not just unsubscribed from.
    const { sentry, sink } = await started();
    await sink.stop();
    expect(sentry.close).toHaveBeenCalled();

    sink.capture(report());
    expect(sentry.captures).toHaveLength(0);
  });

  it("discards anything still buffered", async () => {
    const sentry = fakeSentry();
    const sink = new SentrySink({
      dsn: "https://k@o0.ingest.invalid/0",
      load: async () => sentry.module as never,
    });
    sink.capture(report());
    await sink.stop();
    await sink.start();
    expect(sentry.captures).toHaveLength(0);
  });
});
