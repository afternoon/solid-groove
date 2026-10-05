/**
 * The email an admin gets when the alpha allowlist refuses a sign-in (#1112).
 *
 * `alphaAllowlistGate` records every refused sign-in in `signInAttempts`; a
 * separate Firestore trigger (`allowlistBlockedSignInAlert` in
 * `functions/src/index.ts`) watches those documents and runs
 * {@link alertBlockedSignIn}. It is a separate trigger so a slow or broken mail
 * server can never delay or fail a sign-in. Everything here is Firebase-free,
 * so it is unit-tested here and runs unchanged in the function, which only
 * supplies the config, the transport and the logger.
 *
 * Nothing this module logs names the address: the email carries it, to the
 * admin alone, and the logs do not.
 */
import type { SignInAttempt } from "./allowlist";

/**
 * How long an address must have been quiet before a new refusal emails again.
 * Someone retrying a few times in a row is one alert, not one per click.
 */
export const ALERT_QUIET_PERIOD_MS = 24 * 60 * 60 * 1000;

/** The line logged when there is nowhere to send an alert. */
export const ALERT_NOT_CONFIGURED = "allowlist alert skipped: not configured";

/**
 * Whether a write to `signInAttempts/{email}` deserves an email: the document
 * was created (a first refusal), or its `lastAttemptAt` moved forward by at
 * least {@link ALERT_QUIET_PERIOD_MS} (someone came back after a quiet spell).
 * A delete (an approval removes the attempt), a retry within the quiet period,
 * and a write that leaves `lastAttemptAt` alone send nothing.
 */
export function shouldAlertBlockedSignIn(
  before: SignInAttempt | null,
  after: SignInAttempt | null,
): boolean {
  if (!after) return false;
  if (!before) return true;
  return after.lastAttemptAt - before.lastAttemptAt >= ALERT_QUIET_PERIOD_MS;
}

/** One alert, ready for a transport. */
export interface AlertMessage {
  to: string;
  subject: string;
  text: string;
}

/** The subject and plain-text body for one refused address. */
export function blockedSignInEmail(
  attempt: SignInAttempt,
  siteOrigin: string,
): Pick<AlertMessage, "subject" | "text"> {
  return {
    subject: `Groove: blocked sign-in from ${attempt.email}`,
    text: [
      "Someone who is not on the alpha allowlist tried to sign in to Groove.",
      "",
      `Address: ${attempt.email}`,
      `Attempts: ${attempt.count}`,
      `First attempt: ${new Date(attempt.firstAttemptAt).toISOString()}`,
      `Last attempt: ${new Date(attempt.lastAttemptAt).toISOString()}`,
      "",
      `Approve them at ${siteOrigin}/admin`,
      "",
    ].join("\n"),
  };
}

/** Where alerts go. Either empty means alerts are off. */
export interface AlertConfig {
  /** The admin's address (`ALLOWLIST_ALERT_TO`). */
  to: string;
  /** An SMTP URL such as `smtps://user:pass@smtp.gmail.com` (`ALLOWLIST_ALERT_SMTP_URL`). */
  smtpUrl: string;
}

/**
 * The sender an SMTP URL implies: its user name when that is an address (as
 * with a Gmail app password), so the mail server sees mail from the account
 * it authenticated. `null` when the URL names no address.
 */
export function alertSender(smtpUrl: string): string | null {
  try {
    const user = decodeURIComponent(new URL(smtpUrl).username);
    return user.includes("@") ? user : null;
  } catch {
    return null;
  }
}

/** What the function hands {@link alertBlockedSignIn}. */
export interface AlertDependencies {
  before: SignInAttempt | null;
  after: SignInAttempt | null;
  config: AlertConfig;
  siteOrigin: string;
  /** Sends one message over the SMTP URL; rejects on failure. */
  send(smtpUrl: string, message: AlertMessage & { from: string }): Promise<void>;
  logger: {
    info(message: string): void;
    warn(message: string, details?: Record<string, unknown>): void;
  };
}

export type AlertOutcome = "not_needed" | "not_configured" | "sent" | "failed";

/**
 * Emails the admin about a refused sign-in when {@link shouldAlertBlockedSignIn}
 * says so. Never throws: an alert that is not configured is skipped with one
 * log line, and one that fails to send is logged as a warning and dropped. A
 * missed alert is acceptable, since the attempt is still listed in `/admin`.
 */
export async function alertBlockedSignIn(deps: AlertDependencies): Promise<AlertOutcome> {
  const { before, after, config, logger } = deps;
  if (!after || !shouldAlertBlockedSignIn(before, after)) return "not_needed";
  const to = config.to.trim();
  const smtpUrl = config.smtpUrl.trim();
  if (!to || !smtpUrl) {
    logger.info(ALERT_NOT_CONFIGURED);
    return "not_configured";
  }
  try {
    await deps.send(smtpUrl, {
      from: alertSender(smtpUrl) ?? to,
      to,
      ...blockedSignInEmail(after, deps.siteOrigin),
    });
    return "sent";
  } catch (error) {
    // A mail server's message can quote the recipient or the blocked address,
    // so only its code is logged.
    const code = (error as { code?: unknown } | null)?.code;
    logger.warn("allowlist alert failed to send", {
      code: typeof code === "string" || typeof code === "number" ? code : "unknown",
    });
    return "failed";
  }
}
