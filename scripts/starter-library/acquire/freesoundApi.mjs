// A Freesound API client that only ever returns CC0-licensed sounds.
//
// docs/sample-library.md section 4.2 forbids bulk-importing a search result page
// blindly. The reason the previous candidate list was noisy is that it was mined
// from the Freesound Loop Dataset (an 8.8 GB archive whose per-sound licence is
// not in the metadata), so every Freesound candidate landed as `unconfirmed` and
// a curator had to open ~1000 pages to find the CC0 ones. This client is the fix:
// it queries the *source of truth* — the Freesound API returns each sound's
// `license` directly — and filters to `Creative Commons 0` SERVER-SIDE, so a
// non-CC0 sound is never turned into a candidate at all.
//
// This is not a crawl of a whole site or tag. It runs a small set of *named-gap*
// queries (a 909 kick, an 808, an open hat, …) written down in `freesoundGaps.mjs`
// — the same "a person named this, not a spider found it" posture as the rest of
// the pipeline. Every result is still only a *candidate page* a curator auditions
// before anything is pinned; the API resolves the licence, not the sound quality
// or the provenance (did the uploader actually make it — section 3.3), which stay
// a human call.
//
// The token: basic text search works unauthenticated but is heavily rate-limited,
// so `library:freesound` reads FREESOUND_API_KEY (a free token from
// https://freesound.org/apiv2/apply/) when present and passes it as `&token=`.
// Generation is a rare, by-hand step, so a missing key is a soft failure with a
// clear message, not a build gate.

/** The exact `license` string the API uses for CC0. Section 3.2's only route. */
export const FREESOUND_CC0 = "Creative Commons 0";

const SEARCH_ENDPOINT = "https://freesound.org/apiv2/search/text/";

/** Fields we need to seed a candidate form; keep it small to stay well-behaved. */
const FIELDS = [
	"id",
	"name",
	"license",
	"username",
	"duration",
	"channels",
	"bitdepth",
	"samplerate",
	"tags",
	"bpm",
	"type",
].join(",");

/**
 * Build the query string for one gap query. `license:"Creative Commons 0"` does
 * the filtering on Freesound's side, so a non-CC0 sound never comes back. A few
 * shared guards keep obviously unusable material out before a human ever sees it:
 * short durations (one-shots and short loops, not 10-minute field recordings) and
 * — belt and braces over section 3.3 — nothing tagged as speech or vocal.
 *
 * @param {import("./freesoundGaps.mjs").Gap} gap
 * @param {{ pageSize?: number }} [opts]
 */
export function buildSearchUrl(gap, { pageSize = 15 } = {}) {
	const filters = [
		`license:"${FREESOUND_CC0}"`,
		// A one-shot or a short loop; keeps out long field recordings and mixes.
		`duration:[${gap.minDuration ?? 0.05} TO ${gap.maxDuration ?? 12}]`,
		// Section 3.3: no identifiable speech or performances in the first intake.
		"-tag:speech",
		"-tag:vocal",
		"-tag:voice",
		...(gap.extraFilters ?? []),
	];
	const params = new URLSearchParams({
		query: gap.query,
		filter: filters.join(" "),
		fields: FIELDS,
		sort: gap.sort ?? "score",
		page_size: String(pageSize),
	});
	return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

/**
 * Run one gap query and return the raw CC0 sound records. `fetchImpl` is
 * injectable so tests never touch the network; `token` is appended when set.
 *
 * A result whose `license` is not exactly the CC0 string is dropped defensively,
 * even though the server filter should already exclude it — the licence gate is
 * the whole point of this module, so it never trusts the response shape alone.
 *
 * @returns {Promise<{ ok: boolean, sounds: object[], error?: string }>}
 */
export async function searchGap(
	gap,
	{ token, fetchImpl = fetch, pageSize = 15 } = {},
) {
	let url = buildSearchUrl(gap, { pageSize });
	if (token) url += `&token=${encodeURIComponent(token)}`;

	let response;
	try {
		response = await fetchImpl(url);
	} catch (error) {
		return {
			ok: false,
			sounds: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
	if (!response.ok) {
		const detail =
			response.status === 401 || response.status === 429
				? " (set FREESOUND_API_KEY — get a free token at https://freesound.org/apiv2/apply/)"
				: "";
		return {
			ok: false,
			sounds: [],
			error: `HTTP ${response.status} for "${gap.query}"${detail}`,
		};
	}
	const body = await response.json();
	const sounds = (body.results ?? []).filter(
		(sound) => sound.license === FREESOUND_CC0,
	);
	return { ok: true, sounds };
}
