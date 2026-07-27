#!/usr/bin/env node
// The sample-library management tool.
//
//   bun run library:manage              # crawl candidates, serve the review UI on :4181
//   bun run library:manage -- --port N
//
// This is the human half of acquisition (docs/sample-library.md section 4.2)
// with a UI attached. It reads the curated list of candidate sample *pages* in
// `acquire/candidates.json`, makes a best-effort guess at each one's audio URL
// and metadata, and lets a reviewer step through them one at a time — the source
// page in an iframe, the guessed metadata in an editable form.
//
// Clicking Verify writes a *draft* selection to `sources.lock.json`: everything
// a person confirmed by looking at the page, but no checksum. The checksum is
// recorded separately by `library:acquire --pin`, which downloads the file. That
// separation is deliberate and unchanged: a pin is a record that specific bytes
// arrived, and this tool never downloads audio for redistribution — it only
// reads the page a reviewer already chose. There is still no crawl mode and no
// search mode.

import { createServer } from "node:http";
import {
	CANDIDATES_PATH,
	crawlCandidate,
	readCandidates,
	validateCandidates,
} from "./acquire/candidates.mjs";
import {
	appendSelection,
	LOCKFILE_PATH,
	readLockfile,
	writeLockfile,
} from "./acquire/lockfile.mjs";
import { renderManagePage } from "./managePage.mjs";
import { acquirablePacks } from "./packs.mjs";
import {
	CHARACTERS,
	GENRES,
	INTENSITIES,
	SOURCE_TYPES,
	TAXONOMY,
} from "./taxonomy.mjs";

export const DEFAULT_PORT = 4181;

export function parseArgs(argv) {
	const args = { port: DEFAULT_PORT };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--port") {
			args.port = Number(argv[++i]);
			if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
				throw new Error(`--port must be a valid port number, got: ${argv[i]}`);
			}
		} else {
			throw new Error(`unknown flag: ${flag}`);
		}
	}
	return args;
}

const taxonomyForPage = () =>
	Object.entries(TAXONOMY).map(([family, roles]) => ({ family, roles }));

function readBody(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

/**
 * Load the candidate list and merge in any selection already committed to the
 * lockfile, so a reopened session shows what was verified last time.
 *
 * Crawling is deliberately NOT done here. At ~1000 candidates, fetching every
 * page on startup would be slow and would hammer the sources; instead each page
 * is crawled on demand when the reviewer navigates to it (`/crawl`). This
 * returns the lightweight list the UI needs to render its progress and forms.
 */
export function prepareCandidates({
	candidates: candidateList,
	lockfilePath,
} = {}) {
	const config = candidateList
		? { version: 1, candidates: candidateList }
		: readCandidates();
	const errors = validateCandidates(config);
	if (errors.length > 0) {
		throw new Error(
			`${CANDIDATES_PATH} is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
		);
	}

	const existing = new Map(
		readLockfile(lockfilePath).selections.map((selection) => [
			selection.id,
			selection,
		]),
	);

	return config.candidates.map((candidate) => {
		const draft = existing.get(candidate.id) ?? null;
		return {
			id: candidate.id,
			sourceId: candidate.sourceId,
			pageUrl: candidate.pageUrl,
			note: candidate.note ?? null,
			licenseConfidence: candidate.licenseConfidence ?? "unconfirmed",
			seedAsset: candidate.asset ?? null,
			// The crawl result is filled in lazily by /crawl; null until then.
			crawl: null,
			draft,
			verified: Boolean(draft),
		};
	});
}

export function createManageServer({ candidates, onVerify, crawl }) {
	const page = Buffer.from(
		renderManagePage({
			taxonomy: taxonomyForPage(),
			genres: GENRES,
			characters: CHARACTERS,
			intensities: INTENSITIES,
			sourceTypes: SOURCE_TYPES,
			packs: acquirablePacks().map(({ slug, name }) => ({ slug, name })),
		}),
	);

	const json = (response, code, value) => {
		response.writeHead(code, {
			"content-type": "application/json",
			"cache-control": "no-store",
		});
		response.end(JSON.stringify(value));
	};

	return createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");

		if (
			request.method === "GET" &&
			(url.pathname === "/" || url.pathname === "/index.html")
		) {
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(page);
			return;
		}

		if (request.method === "GET" && url.pathname === "/candidates") {
			json(response, 200, { candidates });
			return;
		}

		// Crawl one page on demand, when the reviewer navigates to it. Cached on
		// the in-memory entry so revisiting a candidate does not refetch.
		if (request.method === "GET" && url.pathname === "/crawl") {
			const id = url.searchParams.get("id");
			const entry = candidates.find((c) => c.id === id);
			if (!entry) {
				json(response, 404, { error: `no candidate ${id}` });
				return;
			}
			if (!entry.crawl && crawl) {
				entry.crawl = await crawl(entry);
			}
			json(response, 200, { crawl: entry.crawl });
			return;
		}

		if (request.method === "POST" && url.pathname === "/verify") {
			try {
				const selection = JSON.parse(await readBody(request));
				const saved = onVerify(selection);
				// Reflect the write back into the in-memory list so the session
				// stays consistent with the file on disk.
				const entry = candidates.find((c) => c.id === selection.id);
				if (entry) {
					entry.draft = saved;
					entry.verified = true;
				}
				json(response, 200, { ok: true, selection: saved });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// appendSelection throws "…:\n  - problem\n  - problem". Drop the
				// header line and keep the bulleted problems for the UI to show.
				const errors = message
					.split("\n")
					.filter((line) => /^\s*-\s/.test(line))
					.map((line) => line.replace(/^\s*-\s*/, "").trim());
				json(response, 400, {
					ok: false,
					error: errors[0] ?? message,
					errors: errors.length ? errors : [message],
				});
			}
			return;
		}

		response.writeHead(404, { "content-type": "text/plain" });
		response.end("not found\n");
	});
}

/**
 * Append a verified selection to the lockfile on disk. Kept separate from the
 * server so it can be tested directly and so the write path is obvious: read,
 * append (or replace by id), write sorted. `now` is injectable for tests.
 */
export function verifySelection(selection, { now, path = LOCKFILE_PATH } = {}) {
	const lockfile = readLockfile(path);
	const updated = appendSelection(lockfile, selection);
	const timestamp = now ?? new Date().toISOString();
	writeLockfile(updated, { updatedAt: timestamp, path });
	return selection;
}

/**
 * Turn a lightweight in-memory entry back into the candidate shape
 * `crawlCandidate` expects, and crawl its page. Used as the server's on-demand
 * `crawl` hook so pages are fetched one at a time, as the reviewer reaches them.
 */
function crawlEntry(entry, { fetchImpl } = {}) {
	return crawlCandidate(
		{
			id: entry.id,
			sourceId: entry.sourceId,
			pageUrl: entry.pageUrl,
			note: entry.note,
			licenseConfidence: entry.licenseConfidence,
			asset: entry.seedAsset,
		},
		{ fetchImpl },
	);
}

export async function manage({ port = DEFAULT_PORT, log = console.log } = {}) {
	const candidates = prepareCandidates();

	const server = createManageServer({
		candidates,
		onVerify: (selection) => verifySelection(selection),
		crawl: (entry) => crawlEntry(entry),
	});
	await new Promise((resolve, reject) => {
		server.once("error", (error) => {
			reject(
				error.code === "EADDRINUSE"
					? new Error(`port ${port} is in use — pass --port to pick another`)
					: error,
			);
		});
		server.listen(port, "127.0.0.1", resolve);
	});

	log("");
	log(
		`  ⚙  review ${candidates.length} candidates at  http://127.0.0.1:${port}`,
	);
	log("");
	log("     Each page is crawled on demand as you reach it — nothing is");
	log("     fetched up front, and nothing is downloaded for redistribution.");
	log("     Listen on each page, confirm the metadata, click Verify.");
	log(`     Verified drafts are written to ${LOCKFILE_PATH}.`);
	log("     Then: bun run library:acquire -- --pin   (records checksums)");
	log("           review the diff, commit, and bun run library:acquire");
	log("     Ctrl-C when you are done.");

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			server.close();
			process.exit(0);
		});
	}
	return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await manage(parseArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
