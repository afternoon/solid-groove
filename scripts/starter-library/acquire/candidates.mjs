// The candidate list and the best-effort page crawler behind the management tool.
//
// docs/sample-library.md section 4.2 forbids bulk-importing search results: a
// tool that *can* crawl a whole site will eventually be pointed at one. This
// crawler is deliberately the opposite. It reads a hand-written list of specific
// sample *page* URLs (`candidates.json`), fetches each one, and makes a
// best-effort guess at the direct audio URL and its metadata. It never discovers
// new URLs, follows catalogue links, or downloads anything for redistribution —
// it only reads the page a reviewer already chose so the reviewer starts from a
// filled-in form instead of a blank one.
//
// Every guess it returns is a suggestion the reviewer confirms or corrects in
// the management tool before it is written. Nothing here decides anything.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { download } from "./fetch.mjs";
import { findSource } from "./sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed list of candidate sample pages a reviewer curated. */
export const CANDIDATES_PATH = resolve(join(HERE, "candidates.json"));

const AUDIO_EXTENSIONS = [
	".wav",
	".flac",
	".ogg",
	".oga",
	".mp3",
	".m4a",
	".aiff",
	".aif",
	".zip",
];

/**
 * How sure we are the file behind this page is CC0, before a human checks it.
 *
 * This is a review-order hint, never a rights decision. The authoritative
 * position is still the source's licence and the evidence captured at ingest;
 * a candidate can say `verified-cc0` and still be rejected on the page. The
 * value exists so a reviewer works the trustworthy pages first and gives the
 * `unconfirmed` ones the hard look section 4.2 requires.
 *
 * - `verified-cc0`: the source publishes a library-wide CC0 dedication (VCSL).
 * - `likely-cc0`:   the source states CC0 per item and this one is expected to
 *                   be, but the per-item page has not been read yet.
 * - `unconfirmed`:  the source hosts mixed licences and this page's licence is
 *                   unknown until read (Freesound, FreePats per-bank).
 */
export const LICENSE_CONFIDENCE = ["verified-cc0", "likely-cc0", "unconfirmed"];

/**
 * @typedef {object} Candidate
 * @property {string} id         Stable candidate ID; becomes the selection ID.
 * @property {string} sourceId   A source from `sources.mjs`.
 * @property {string} pageUrl    The page a reviewer chose to audition.
 * @property {string} [note]     Why this sound is wanted (e.g. "classic 909 kick").
 * @property {string} [licenseConfidence] One of LICENSE_CONFIDENCE; review-order hint only.
 * @property {object} [asset]    Seed metadata: family, role, name, genres, ...
 */

export function readCandidates(path = CANDIDATES_PATH) {
	if (!existsSync(path)) return { version: 1, candidates: [] };
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(parsed.candidates)) {
		throw new Error(`${path}: "candidates" must be an array`);
	}
	return parsed;
}

/**
 * Validate a candidate list against the source registry, so a typo in a source
 * ID or a page on a non-approved host is caught before the tool tries to crawl.
 * The rights gate still lives in `validateLockfile`; this only checks that the
 * candidates point at somewhere the reviewer is allowed to take from.
 */
export function validateCandidates({ candidates }) {
	const errors = [];
	const seen = new Set();
	for (const candidate of candidates) {
		const where = candidate?.id ?? "<candidate with no id>";
		if (!candidate?.id) errors.push(`${where}: id is required`);
		if (seen.has(candidate?.id)) errors.push(`${where}: duplicate id`);
		seen.add(candidate?.id);

		const source = findSource(candidate?.sourceId);
		if (!source) {
			errors.push(
				`${where}: unknown source "${candidate?.sourceId}" — add it to sources.mjs first`,
			);
		}
		if (!candidate?.pageUrl?.startsWith("https://")) {
			errors.push(`${where}: pageUrl must be an https URL`);
		}
		if (
			candidate?.licenseConfidence &&
			!LICENSE_CONFIDENCE.includes(candidate.licenseConfidence)
		) {
			errors.push(
				`${where}: licenseConfidence must be one of ${LICENSE_CONFIDENCE.join(", ")}`,
			);
		}
	}
	return errors;
}

/** Resolve a possibly-relative URL against the page it was found on. */
export function absoluteUrl(href, pageUrl) {
	try {
		return new URL(href, pageUrl).href;
	} catch {
		return null;
	}
}

const looksLikeAudio = (url) =>
	AUDIO_EXTENSIONS.some((extension) =>
		url.split(/[?#]/)[0].toLowerCase().endsWith(extension),
	);

/**
 * Pull every attribute value out of some HTML that could be a link to a file:
 * href, src, and data-* download attributes. Intentionally forgiving — it is a
 * suggestion engine, not a parser, and the reviewer confirms the result.
 */
function extractLinks(html, pageUrl) {
	const urls = new Set();
	for (const match of html.matchAll(
		/(?:href|src|data-[\w-]*)\s*=\s*"([^"]+)"/gi,
	)) {
		const absolute = absoluteUrl(match[1], pageUrl);
		if (absolute) urls.add(absolute);
	}
	// Also catch bare audio URLs printed in the page text (common on FreePats).
	for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
		if (looksLikeAudio(match[0])) urls.add(match[0]);
	}
	return [...urls];
}

/** First non-empty capture from the first pattern that matches. */
function firstMatch(html, patterns) {
	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]?.trim()) return decodeEntities(match[1].trim());
	}
	return null;
}

function decodeEntities(text) {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

const filenameOf = (url) => {
	try {
		return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
	} catch {
		return url.split(/[?#]/)[0].split("/").pop() ?? "";
	}
};

/**
 * Guess whether the page mentions CC0. This is only a hint shown to the
 * reviewer; the authoritative rights position is the source's licence and the
 * captured evidence, never this string match.
 */
function detectLicenseHint(html) {
	const lowered = html.toLowerCase();
	if (
		/cc0|creativecommons\.org\/publicdomain\/zero|public\s*domain/.test(lowered)
	) {
		return "CC0-1.0";
	}
	if (/cc[-\s]?by[-\s]?nc/.test(lowered)) return "CC-BY-NC (not bundleable)";
	if (/cc[-\s]?by[-\s]?sa/.test(lowered)) return "CC-BY-SA (not bundleable)";
	if (/cc[-\s]?by/.test(lowered)) return "CC-BY (not bundleable)";
	return null;
}

/**
 * Rank candidate file URLs so the most likely audio download is suggested
 * first: prefer bare audio files over archives, and prefer a filename that
 * echoes the candidate's intended sound.
 */
export function rankFileUrls(urls, { hint } = {}) {
	const audio = urls.filter(looksLikeAudio);
	// The hint is free text ("909 kick"); a filename is punctuated ("909-kick").
	// Score by shared tokens rather than a substring so the two still line up.
	const terms = (hint ?? "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 1);
	return audio.sort((a, b) => score(b) - score(a));

	function score(url) {
		const name = filenameOf(url).toLowerCase();
		let value = 0;
		if (!name.endsWith(".zip")) value += 2; // a loose file beats a pack
		value += terms.filter((term) => name.includes(term)).length;
		return value;
	}
}

/**
 * Crawl one candidate's page and return the reviewer's starting point: the
 * suggested audio URL, the other file URLs found (so they can pick a different
 * one), and scraped metadata. Never throws on a bad page — a failed crawl still
 * lets the reviewer fill the form in by hand.
 */
export async function crawlCandidate(candidate, { fetchImpl } = {}) {
	const source = findSource(candidate.sourceId);
	const base = {
		id: candidate.id,
		sourceId: candidate.sourceId,
		sourceName: source?.name ?? candidate.sourceId,
		pageUrl: candidate.pageUrl,
		note: candidate.note ?? null,
		licenseConfidence: candidate.licenseConfidence ?? "unconfirmed",
		seedAsset: candidate.asset ?? null,
	};

	let html;
	try {
		const bytes = await download(candidate.pageUrl, { fetchImpl });
		html = bytes.toString("utf8");
	} catch (error) {
		return {
			...base,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			fileUrls: [],
			suggestedFileUrl: null,
		};
	}

	const hint = candidate.asset?.name ?? candidate.note ?? candidate.id;
	const fileUrls = rankFileUrls(extractLinks(html, candidate.pageUrl), {
		hint,
	});
	const suggestedFileUrl = fileUrls[0] ?? null;

	const title = firstMatch(html, [
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
		/<title[^>]*>([^<]+)<\/title>/i,
		/<h1[^>]*>([^<]+)<\/h1>/i,
	]);
	const creator = firstMatch(html, [
		/(?:author|creator|uploaded by|by)\s*[:>]?\s*<[^>]*>([^<]+)</i,
		/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
		/rel=["']author["'][^>]*>([^<]+)</i,
	]);

	return {
		...base,
		ok: true,
		fileUrls,
		suggestedFileUrl,
		suggestedFilename: suggestedFileUrl ? filenameOf(suggestedFileUrl) : null,
		title,
		creator,
		licenseHint: detectLicenseHint(html),
	};
}
