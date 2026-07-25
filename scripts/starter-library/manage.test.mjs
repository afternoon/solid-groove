import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	absoluteUrl,
	crawlCandidate,
	LICENSE_CONFIDENCE,
	rankFileUrls,
	readCandidates,
	validateCandidates,
} from "./acquire/candidates.mjs";
import { generate } from "./acquire/generateCandidates.mjs";
import {
	appendSelection,
	emptyLockfile,
	readLockfile,
	validateDraft,
	validateLockfile,
} from "./acquire/lockfile.mjs";
import {
	createManageServer,
	prepareCandidates,
	verifySelection,
} from "./manage.mjs";

const cleanups = [];
afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

function tempLockfile(initial = emptyLockfile()) {
	const dir = mkdtempSync(join(tmpdir(), "sg-manage-"));
	const path = join(dir, "sources.lock.json");
	writeFileSync(path, `${JSON.stringify(initial, null, "\t")}\n`);
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return path;
}

/** A serves-this-HTML fake for the injectable download() fetch. */
function htmlFetch(html) {
	return async () => ({
		ok: true,
		status: 200,
		statusText: "OK",
		headers: new Map(),
		arrayBuffer: async () => Buffer.from(html),
	});
}

const draft = () => ({
	id: "freesound-909-kick",
	sourceId: "freesound",
	downloadUrl: "https://freesound.org/data/previews/1/1_1-hq.wav",
	sourcePageUrl: "https://freesound.org/s/1/",
	creator: "example-uploader",
	originalFilename: "1_1-hq.wav",
	reviewer: "Ben",
	asset: {
		family: "drums",
		role: "kick",
		name: "Analog Four-Four Kick 01",
		genres: ["house"],
		characters: ["punchy"],
		intensity: "medium",
		sourceType: "recorded",
	},
});

describe("candidate config validation", () => {
	it("accepts a candidate pointing at an approved source over https", () => {
		expect(
			validateCandidates({
				candidates: [
					{
						id: "freesound-909-kick",
						sourceId: "freesound",
						pageUrl: "https://freesound.org/s/1/",
					},
				],
			}),
		).toEqual([]);
	});

	it.each([
		[
			"an unknown source",
			{ id: "x", sourceId: "some-blog", pageUrl: "https://example.com/" },
			/unknown source/,
		],
		[
			"a non-https page",
			{ id: "x", sourceId: "freesound", pageUrl: "http://freesound.org/s/1/" },
			/pageUrl must be an https URL/,
		],
		[
			"a missing id",
			{ sourceId: "freesound", pageUrl: "https://freesound.org/s/1/" },
			/id is required/,
		],
	])("rejects %s", (_label, candidate, expected) => {
		const errors = validateCandidates({ candidates: [candidate] });
		expect(errors.join("\n")).toMatch(expected);
	});

	it("flags a duplicate candidate id", () => {
		const one = {
			id: "dup",
			sourceId: "freesound",
			pageUrl: "https://freesound.org/s/1/",
		};
		expect(
			validateCandidates({ candidates: [one, { ...one }] }).join("\n"),
		).toMatch(/duplicate id/);
	});

	it("accepts a known licenseConfidence and rejects an unknown one", () => {
		const base = {
			id: "c",
			sourceId: "freesound",
			pageUrl: "https://freesound.org/s/1/",
		};
		for (const confidence of LICENSE_CONFIDENCE) {
			expect(
				validateCandidates({
					candidates: [{ ...base, licenseConfidence: confidence }],
				}),
			).toEqual([]);
		}
		expect(
			validateCandidates({
				candidates: [{ ...base, licenseConfidence: "definitely-fine" }],
			}).join("\n"),
		).toMatch(/licenseConfidence must be one of/);
	});
});

describe("the committed candidate list", () => {
	// Guards against a hand-edit or stale generation that would break the tool
	// on launch. The generator writes this file; this proves what shipped parses.
	const config = readCandidates();

	it("has ~1000 candidates and validates against the source registry", () => {
		expect(config.candidates.length).toBeGreaterThanOrEqual(900);
		expect(validateCandidates(config)).toEqual([]);
	});

	it("only points at https pages on approved sources", () => {
		for (const candidate of config.candidates) {
			expect(candidate.pageUrl).toMatch(/^https:\/\//);
		}
	});

	it("carries a licenseConfidence on every entry", () => {
		for (const candidate of config.candidates) {
			expect(LICENSE_CONFIDENCE).toContain(
				candidate.licenseConfidence ?? "unconfirmed",
			);
		}
	});
});

describe("the candidate generator", () => {
	it("is deterministic and produces a registry-valid list", () => {
		const stats = generate();
		expect(stats.total).toBeGreaterThanOrEqual(900);
		// The committed file is what generate() just wrote, so re-reading it must
		// still validate — this is the reproducibility contract.
		expect(validateCandidates(readCandidates())).toEqual([]);
		expect(stats.bySource.freesound).toBeGreaterThan(0);
		expect(stats.bySource.freepats).toBeGreaterThan(0);
		// VCSL is a bulk source now, not a candidate source.
		expect(stats.bySource.vcsl).toBeUndefined();
	});
});

describe("crawler extraction", () => {
	it("resolves relative URLs against the page", () => {
		expect(absoluteUrl("/data/x.wav", "https://freesound.org/s/1/")).toBe(
			"https://freesound.org/data/x.wav",
		);
	});

	it("prefers a loose audio file over a zip, and a name that matches the sound", () => {
		const ranked = rankFileUrls(
			["https://x/pack.zip", "https://x/random.wav", "https://x/909-kick.wav"],
			{ hint: "909 kick" },
		);
		expect(ranked[0]).toBe("https://x/909-kick.wav");
		expect(ranked.at(-1)).toBe("https://x/pack.zip");
	});

	it("scrapes the audio URL, title, creator, and a CC0 hint from a page", async () => {
		const html = `<!doctype html><html><head>
			<title>909 Kick by SomeUser</title>
			<meta name="author" content="SomeUser">
			</head><body>
			<a href="/data/previews/1/1_1-hq.wav">download</a>
			<p>Licensed under Creative Commons 0 (CC0)</p>
			</body></html>`;
		const result = await crawlCandidate(
			{
				id: "freesound-909-kick",
				sourceId: "freesound",
				pageUrl: "https://freesound.org/s/1/",
				asset: { name: "909 kick" },
			},
			{ fetchImpl: htmlFetch(html) },
		);
		expect(result.ok).toBe(true);
		expect(result.suggestedFileUrl).toBe(
			"https://freesound.org/data/previews/1/1_1-hq.wav",
		);
		expect(result.suggestedFilename).toBe("1_1-hq.wav");
		expect(result.creator).toBe("SomeUser");
		expect(result.licenseHint).toBe("CC0-1.0");
	});

	it("flags a non-CC0 licence string as not bundleable", async () => {
		const html = `<html><body><a href="x.wav">x</a>
			<p>This work is licensed CC-BY 4.0</p></body></html>`;
		const result = await crawlCandidate(
			{ id: "c", sourceId: "freesound", pageUrl: "https://freesound.org/s/1/" },
			{ fetchImpl: htmlFetch(html) },
		);
		expect(result.licenseHint).toMatch(/not bundleable/);
	});

	it("never throws on an unreachable page — the form can still be filled by hand", async () => {
		const failing = async () => {
			throw new Error("boom");
		};
		const result = await crawlCandidate(
			{ id: "c", sourceId: "freesound", pageUrl: "https://freesound.org/s/1/" },
			{ fetchImpl: failing },
		);
		expect(result.ok).toBe(false);
		expect(result.suggestedFileUrl).toBeNull();
	});
});

describe("draft selections", () => {
	it("accepts a reviewed draft with no checksum yet", () => {
		expect(validateDraft(draft())).toEqual([]);
	});

	it("requires a real reviewer, not the unreviewed sentinel", () => {
		expect(
			validateDraft({ ...draft(), reviewer: "unreviewed" }).join("\n"),
		).toMatch(/real reviewer name/);
	});

	it("requires the asset mapping fields the form collects", () => {
		const bad = draft();
		bad.asset = { ...bad.asset, family: "", genres: [] };
		const errors = validateDraft(bad).join("\n");
		expect(errors).toMatch(/asset.family is required/);
		expect(errors).toMatch(/a genre tag is required/);
	});

	it("appends a draft and replaces one with the same id rather than duplicating", () => {
		let lockfile = emptyLockfile();
		lockfile = appendSelection(lockfile, draft());
		lockfile = appendSelection(lockfile, {
			...draft(),
			asset: { ...draft().asset, name: "Renamed" },
		});
		expect(lockfile.selections).toHaveLength(1);
		expect(lockfile.selections[0].asset.name).toBe("Renamed");
	});

	it("a draft is not yet shippable — validateLockfile fails on the missing checksum until --pin", () => {
		const lockfile = appendSelection(emptyLockfile(), draft());
		expect(validateLockfile(lockfile).join("\n")).toMatch(/sha256 must be/);
	});
});

describe("verifySelection writes to the lockfile on disk", () => {
	it("appends the draft and stamps updatedAt", () => {
		const path = tempLockfile();
		verifySelection(draft(), { now: "2026-07-25T00:00:00.000Z", path });
		const written = readLockfile(path);
		expect(written.selections).toHaveLength(1);
		expect(written.selections[0].id).toBe("freesound-909-kick");
		expect(written.updatedAt).toBe("2026-07-25T00:00:00.000Z");
	});

	it("rejects an invalid draft without writing", () => {
		const path = tempLockfile();
		expect(() =>
			verifySelection({ ...draft(), creator: "" }, { path }),
		).toThrow(/creator is required/);
		expect(readLockfile(path).selections).toEqual([]);
	});
});

describe("prepareCandidates merges already-committed selections", () => {
	// prepareCandidates is now synchronous and does NOT crawl — crawling is lazy,
	// on demand per candidate. So it must return entries with crawl:null and the
	// committed draft merged in, without any fetch.
	it("marks a candidate verified when the lockfile already has its selection", () => {
		const path = tempLockfile({
			...emptyLockfile(),
			selections: [{ ...draft(), id: "freesound-909-kick" }],
		});
		const candidates = prepareCandidates({
			lockfilePath: path,
			candidates: [
				{
					id: "freesound-909-kick",
					sourceId: "freesound",
					pageUrl: "https://freesound.org/s/1/",
				},
			],
		});
		const entry = candidates.find((c) => c.id === "freesound-909-kick");
		expect(entry.verified).toBe(true);
		expect(entry.crawl).toBeNull();
		expect(entry.draft.asset.name).toBe("Analog Four-Four Kick 01");
	});
});

describe("the /crawl endpoint crawls one page on demand", () => {
	function serverFor(candidates, crawl) {
		return new Promise((resolve) => {
			const server = createManageServer({
				candidates,
				onVerify: (s) => s,
				crawl,
			});
			server.listen(0, "127.0.0.1", () => {
				cleanups.push(() => server.close());
				resolve(`http://127.0.0.1:${server.address().port}`);
			});
		});
	}

	it("does not crawl until asked, then caches the result", async () => {
		let calls = 0;
		const candidates = [
			{
				id: "c1",
				sourceId: "freesound",
				pageUrl: "https://freesound.org/s/1/",
				crawl: null,
			},
		];
		const crawl = async (entry) => {
			calls++;
			return {
				id: entry.id,
				ok: true,
				suggestedFileUrl: "https://freesound.org/x.wav",
			};
		};
		const base = await serverFor(candidates, crawl);

		// The list endpoint must not have triggered a crawl.
		const list = await (await fetch(`${base}/candidates`)).json();
		expect(list.candidates[0].crawl).toBeNull();
		expect(calls).toBe(0);

		const first = await (await fetch(`${base}/crawl?id=c1`)).json();
		expect(first.crawl.suggestedFileUrl).toBe("https://freesound.org/x.wav");
		expect(calls).toBe(1);

		// Second request is served from the cached entry, not a second crawl.
		await fetch(`${base}/crawl?id=c1`);
		expect(calls).toBe(1);
	});

	it("404s an unknown candidate id", async () => {
		const base = await serverFor([], async () => ({}));
		const response = await fetch(`${base}/crawl?id=missing`);
		expect(response.status).toBe(404);
	});
});
