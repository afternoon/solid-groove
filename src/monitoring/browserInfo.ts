// Browser and engine identification for error reports (PRD `OPS-03`: reports
// carry "browser and engine version").
//
// Reduced to an enumerated name plus a major version rather than the raw user
// agent string. A full UA string is high-entropy — it is one of the strongest
// browser-fingerprinting inputs — and PRD section 10 limits what telemetry may
// carry. `firefox` / `142` answers "which gating browser broke" without
// carrying a device fingerprint along with it.
//
// This is for *reporting*, never for behavior: PRD section 10 requires that
// "core behavior does not branch only on user-agent strings."

export const BROWSER_NAMES = [
	"chrome",
	"edge",
	"firefox",
	"safari",
	"opera",
	"other",
] as const;
export type BrowserName = (typeof BROWSER_NAMES)[number];

export const ENGINE_NAMES = ["blink", "gecko", "webkit", "other"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export interface BrowserInfo {
	readonly browserName: BrowserName;
	/** Major version only, or `"unknown"`. */
	readonly browserVersion: string;
	readonly engineName: EngineName;
	readonly engineVersion: string;
}

export const UNKNOWN_BROWSER: BrowserInfo = {
	browserName: "other",
	browserVersion: "unknown",
	engineName: "other",
	engineVersion: "unknown",
};

/**
 * Ordered longest-match-first: Edge's UA contains `Chrome/`, Chrome's contains
 * `Safari/`, and Opera's contains both, so the specific tokens must be tested
 * before the generic ones.
 */
const BROWSER_RULES: readonly {
	name: BrowserName;
	pattern: RegExp;
}[] = [
	{ name: "edge", pattern: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
	{ name: "opera", pattern: /\bOPR\/(\d+)/ },
	{ name: "firefox", pattern: /\bFirefox\/(\d+)/ },
	{ name: "chrome", pattern: /\b(?:Chrome|CriOS)\/(\d+)/ },
	{
		name: "safari",
		pattern: /\bVersion\/(\d+)[.\d]*\s+(?:Mobile\/\S+\s+)?Safari/,
	},
];

function majorVersion(match: RegExpExecArray | null): string {
	return match?.[1] ?? "unknown";
}

/**
 * Parses a user-agent string into an enumerated browser and engine.
 *
 * Total: an absent, empty, or unrecognized UA yields `UNKNOWN_BROWSER` rather
 * than throwing, because this runs inside the error-reporting path.
 */
export function parseBrowserInfo(
	userAgent: string | undefined | null,
): BrowserInfo {
	if (typeof userAgent !== "string" || userAgent.length === 0) {
		return UNKNOWN_BROWSER;
	}

	let browserName: BrowserName = "other";
	let browserVersion = "unknown";
	for (const rule of BROWSER_RULES) {
		const match = rule.pattern.exec(userAgent);
		if (match) {
			browserName = rule.name;
			browserVersion = majorVersion(match);
			break;
		}
	}

	const { engineName, engineVersion } = parseEngine(userAgent, browserName);
	return { browserName, browserVersion, engineName, engineVersion };
}

function parseEngine(
	userAgent: string,
	browserName: BrowserName,
): { engineName: EngineName; engineVersion: string } {
	// Gecko's marker is `rv:<version>) Gecko/`; the bare `like Gecko` token in
	// WebKit-derived UAs must not match it.
	const gecko = /\brv:(\d+)[.\d]*\)\s*Gecko\//.exec(userAgent);
	if (gecko) return { engineName: "gecko", engineVersion: gecko[1] };

	const webkit = /\bAppleWebKit\/(\d+)/.exec(userAgent);
	if (webkit) {
		// Chrome, Edge, and Opera all report an AppleWebKit token for historical
		// compatibility but run Blink. Only Safari is genuinely WebKit here.
		const isBlink =
			browserName === "chrome" ||
			browserName === "edge" ||
			browserName === "opera";
		if (isBlink) {
			// Blink's version tracks the browser's, which the caller already has.
			return { engineName: "blink", engineVersion: "unknown" };
		}
		return { engineName: "webkit", engineVersion: webkit[1] };
	}

	return { engineName: "other", engineVersion: "unknown" };
}

/** Reads the current environment's browser info. Safe outside a browser. */
export function currentBrowserInfo(): BrowserInfo {
	try {
		return typeof navigator === "undefined"
			? UNKNOWN_BROWSER
			: parseBrowserInfo(navigator.userAgent);
	} catch {
		return UNKNOWN_BROWSER;
	}
}
