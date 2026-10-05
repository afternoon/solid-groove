import { describe, expect, it, vi } from "vitest";
import type { SignInAttempt } from "./allowlist";
import {
  ALERT_NOT_CONFIGURED,
  ALERT_QUIET_PERIOD_MS,
  type AlertDependencies,
  alertBlockedSignIn,
  alertSender,
  blockedSignInEmail,
  shouldAlertBlockedSignIn,
} from "./blockedSignInAlert";

const FIRST = Date.UTC(2026, 9, 1, 9, 30, 0);

function attempt(lastAttemptAt: number, count = 1): SignInAttempt {
  return { email: "ada@example.com", firstAttemptAt: FIRST, lastAttemptAt, count };
}

describe("shouldAlertBlockedSignIn", () => {
  it("sends on a first refusal, when the document is created", () => {
    expect(shouldAlertBlockedSignIn(null, attempt(FIRST))).toBe(true);
  });

  it("sends nothing for a retry within the quiet period", () => {
    const later = FIRST + ALERT_QUIET_PERIOD_MS - 1;
    expect(shouldAlertBlockedSignIn(attempt(FIRST), attempt(later, 2))).toBe(false);
  });

  it("sends again when someone comes back 24 hours or more after their last attempt", () => {
    const later = FIRST + ALERT_QUIET_PERIOD_MS;
    expect(shouldAlertBlockedSignIn(attempt(FIRST), attempt(later, 2))).toBe(true);
  });

  it("measures the quiet period from the last attempt, not the first", () => {
    const last = FIRST + ALERT_QUIET_PERIOD_MS;
    expect(shouldAlertBlockedSignIn(attempt(last, 2), attempt(last + 60_000, 3))).toBe(
      false,
    );
  });

  it("sends nothing when the document is deleted", () => {
    expect(shouldAlertBlockedSignIn(attempt(FIRST), null)).toBe(false);
  });

  it("sends nothing for an update that leaves lastAttemptAt alone", () => {
    expect(shouldAlertBlockedSignIn(attempt(FIRST), attempt(FIRST, 5))).toBe(false);
  });
});

describe("blockedSignInEmail", () => {
  it("names the address, the count, both times in UTC and the admin page", () => {
    const { subject, text } = blockedSignInEmail(
      attempt(FIRST + ALERT_QUIET_PERIOD_MS + 1_500, 3),
      "https://trygroove.app",
    );
    expect(subject).toBe("Groove: blocked sign-in from ada@example.com");
    expect(text).toContain("Address: ada@example.com");
    expect(text).toContain("Attempts: 3");
    expect(text).toContain("First attempt: 2026-10-01T09:30:00.000Z");
    expect(text).toContain("Last attempt: 2026-10-02T09:30:01.500Z");
    expect(text).toContain("https://trygroove.app/admin");
  });
});

describe("alertSender", () => {
  it("sends from the address the SMTP URL signs in as", () => {
    expect(alertSender("smtps://me%40gmail.com:app-pass@smtp.gmail.com")).toBe(
      "me@gmail.com",
    );
  });

  it("has no sender for a URL with no address in it, or no URL at all", () => {
    expect(alertSender("smtps://apikey:secret@smtp.example.com")).toBeNull();
    expect(alertSender("not a url")).toBeNull();
  });
});

function deps(overrides: Partial<AlertDependencies> = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const send = vi.fn<AlertDependencies["send"]>(async () => {});
  const all: AlertDependencies = {
    before: null,
    after: attempt(FIRST),
    config: {
      to: "admin@example.com",
      smtpUrl: "smtps://me%40gmail.com:pw@smtp.gmail.com",
    },
    siteOrigin: "https://trygroove.app",
    send,
    logger,
    ...overrides,
  };
  return { all, send, logger };
}

/** Everything the logger was handed, as one string. */
function logged(logger: {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
}) {
  return JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
}

describe("alertBlockedSignIn", () => {
  it("emails the admin from the SMTP account on a first refusal", async () => {
    const { all, send } = deps();
    expect(await alertBlockedSignIn(all)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const [url, message] = send.mock.calls[0];
    expect(url).toBe("smtps://me%40gmail.com:pw@smtp.gmail.com");
    expect(message).toMatchObject({
      from: "me@gmail.com",
      to: "admin@example.com",
      subject: "Groove: blocked sign-in from ada@example.com",
    });
  });

  it("does nothing, quietly, when no alert is due", async () => {
    const { all, send, logger } = deps({
      before: attempt(FIRST),
      after: attempt(FIRST + 1, 2),
    });
    expect(await alertBlockedSignIn(all)).toBe("not_needed");
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each([
    ["recipient", { to: " ", smtpUrl: "smtps://u:p@smtp.example.com" }],
    ["SMTP URL", { to: "admin@example.com", smtpUrl: "" }],
  ])("skips with one log line when the %s is empty", async (_, config) => {
    const { all, send, logger } = deps({ config });
    expect(await alertBlockedSignIn(all)).toBe("not_configured");
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(ALERT_NOT_CONFIGURED);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a warning without the address and does not throw when sending fails", async () => {
    const { all, send, logger } = deps();
    send.mockRejectedValueOnce(
      Object.assign(new Error("550 ada@example.com rejected for admin@example.com"), {
        code: "EENVELOPE",
      }),
    );
    expect(await alertBlockedSignIn(all)).toBe("failed");
    expect(logger.warn).toHaveBeenCalledWith("allowlist alert failed to send", {
      code: "EENVELOPE",
    });
    expect(logged(logger)).not.toContain("example.com");
  });
});
