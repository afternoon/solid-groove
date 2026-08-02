#!/usr/bin/env node
// Acquires the CC0 half of the library.
//
//   bun run library:acquire -- --plan     # what is declared and pinned; no network
//   bun run library:acquire -- --pin      # download, hash, and write pins back
//   bun run library:acquire               # download, verify, prepare, ingest
//   bun run library:acquire -- --vcsl     # clone VCSL, bulk-ingest a CC0 subset, delete the clone
//   bun run library:acquire -- --list-bulk         # list the declared trusted bulk CC0 archives
//   bun run library:acquire -- --producer-space [id]  # bulk-ingest a confirmed Producer Space CC0 pack
//   bun run library:acquire -- --freepats-bank  [id]  # bulk-ingest a confirmed FreePats CC0 bank
//
// The bulk paths (--vcsl, --producer-space, --freepats-bank) are for sources
// whose whole archive shares one CC0 licence (section 15.9): the confirmation is
// the archive-wide licence captured once as evidence, not a per-file pin. They do
// not touch sources.lock.json. Everything else below is the per-file path.
//
// The synthesized library needs no network and always works. This adds recorded
// and field-recorded material from the docs/sample-library.md section 4 sources,
// which is the only way to close the section 6.4 organic-source floor that
// synthesis cannot reach.
//
// Nothing is fetched that is not declared in `acquire/sources.mjs` and pinned in
// `sources.lock.json`. `--pin` is the one mode that downloads without a pin, and
// it writes the result for a person to review and commit rather than ingesting
// it. There is no crawl mode and no search mode, by design (section 4.2).

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchToQuarantine } from "./acquire/fetch.mjs";
import {
	captureAllEvidence,
	ingestAll,
	writeAcquiredBundle,
} from "./acquire/ingest.mjs";
import {
	LOCKFILE_PATH,
	readLockfile,
	selectionsBySource,
	validateLockfile,
	writeLockfile,
} from "./acquire/lockfile.mjs";
import { findSource, SOURCES } from "./acquire/sources.mjs";
import { sha256 } from "./wav.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Gitignored: downloaded originals are third-party bytes and are never committed. */
export const QUARANTINE_DIR = join(
	REPO_ROOT,
	"public",
	"samples",
	"quarantine",
);

/** Gitignored: prepared acquired masters, merged into the manifest by `library:build`. */
export const ACQUIRED_DIR = join(
	REPO_ROOT,
	"public",
	"samples",
	"acquired-library",
);

/** Committed: the licence statements captured at acquisition time (section 3.4). */
export const EVIDENCE_DIR = join(REPO_ROOT, "docs", "licenses", "sources");

export function parseArgs(argv) {
	const args = {
		plan: false,
		pin: false,
		only: null,
		vcsl: false,
		bulk: null,
		listBulk: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--plan") args.plan = true;
		else if (flag === "--pin") args.pin = true;
		else if (flag === "--only") args.only = argv[++i] ?? null;
		else if (flag === "--vcsl") args.vcsl = true;
		else if (flag === "--list-bulk") args.listBulk = true;
		// `--producer-space` / `--freepats-bank` take a bulk-source id; with no id
		// they run the first bulk source of that parent (a sensible default so a
		// bare `library:producer-space` does something useful).
		else if (flag === "--producer-space")
			args.bulk = argv[i + 1]?.startsWith("--")
				? "producer-space"
				: (argv[++i] ?? "producer-space");
		else if (flag === "--freepats-bank")
			args.bulk = argv[i + 1]?.startsWith("--")
				? "freepats"
				: (argv[++i] ?? "freepats");
		else if (flag === "--bulk") args.bulk = argv[++i] ?? null;
		else throw new Error(`unknown flag: ${flag}`);
	}
	return args;
}

function reportPlan(lockfile, log) {
	const grouped = selectionsBySource(lockfile);
	log("Approved sources (docs/sample-library.md section 4):");
	for (const source of SOURCES) {
		const count = grouped[source.id]?.length ?? 0;
		log(
			`  ${source.id.padEnd(18)} ${source.tier}  ${source.licenseId.padEnd(16)} ${count}/${source.maxSelections} pinned`,
		);
	}
	log("");
	if (lockfile.selections.length === 0) {
		log("No selections are pinned yet, so there is nothing to acquire.");
		log("");
		log(
			"To add content: choose specific files from an approved source, add them to",
		);
		log(
			`${LOCKFILE_PATH}, run --pin to record their checksums, review, and commit.`,
		);
		return;
	}
	// A selection written by `library:manage` (Verify) is a *draft*: reviewed,
	// but with no checksum until `--pin` downloads it. Show the two apart so it
	// is obvious what still needs pinning before it can be ingested.
	const drafts = lockfile.selections.filter((s) => !s.sha256);
	const pinned = lockfile.selections.filter((s) => s.sha256);
	if (pinned.length > 0) {
		log(`${pinned.length} selections pinned:`);
		for (const selection of pinned) {
			log(
				`  ${selection.id.padEnd(28)} ${selection.asset.family}/${selection.asset.role}  ${selection.asset.name}`,
			);
		}
	}
	if (drafts.length > 0) {
		log("");
		log(`${drafts.length} verified drafts awaiting --pin (no checksum yet):`);
		for (const selection of drafts) {
			log(
				`  ${selection.id.padEnd(28)} ${selection.asset.family}/${selection.asset.role}  ${selection.asset.name}`,
			);
		}
		log("");
		log(
			"Run `bun run library:acquire -- --pin` to download and record their checksums.",
		);
	}
}

/**
 * Download each declared selection and record what actually arrived.
 *
 * This does not ingest and does not decide anything. It produces the checksums
 * a reviewer needs in order to say "yes, that file, those bytes" — the manual
 * step section 4.2 requires and that no script can do on their behalf.
 */
async function pinSelections(lockfile, { log, now }) {
	const pinned = [];
	for (const selection of lockfile.selections) {
		log(`fetching ${selection.id} ...`);
		const downloaded = await fetchToQuarantine(selection, {
			quarantineDir: QUARANTINE_DIR,
			pin: true,
		});
		const updated = {
			...selection,
			sha256: downloaded.sha256,
			bytes: downloaded.bytes.length,
			retrievedAt: selection.retrievedAt ?? now.slice(0, 10),
		};
		if (selection.archiveMember) {
			const { extractMember } = await import("./acquire/archive.mjs");
			updated.memberSha256 = sha256(
				extractMember(downloaded.bytes, selection.archiveMember),
			);
		}
		if (selection.sha256 && selection.sha256 !== downloaded.sha256) {
			log(`  CHANGED: was ${selection.sha256}, now ${downloaded.sha256}`);
			log("  Re-review this file before committing the new pin.");
		}
		pinned.push(updated);
	}
	return { ...lockfile, selections: pinned };
}

/**
 * Resolve a `--bulk`/`--producer-space`/`--freepats-bank` argument to the bulk
 * sources to run: an exact bulk-source id, or a parent source id (run all of its
 * bulk sources). Returns [] with a listed hint if nothing matches.
 */
function resolveBulkSources(arg, BULK_SOURCES) {
	const exact = BULK_SOURCES.find((s) => s.id === arg);
	if (exact) return [exact];
	const byParent = BULK_SOURCES.filter((s) => s.sourceId === arg);
	return byParent;
}

export async function acquire({
	plan = false,
	pin = false,
	only = null,
	vcsl = false,
	bulk = null,
	listBulk = false,
	log = console.log,
	now,
} = {}) {
	const timestamp = now ?? new Date().toISOString();

	if (listBulk || bulk) {
		const { BULK_SOURCES } = await import("./acquire/bulkSources.mjs");
		if (listBulk) {
			log("Trusted bulk CC0 archive sources (one archive = one CC0 licence):");
			for (const s of BULK_SOURCES) {
				log(`  ${s.id.padEnd(38)} ${s.sourceId}`);
				log(`      archive: ${s.archiveUrl}`);
				log(`      licence: ${s.licenseUrl}`);
			}
			log("");
			log(
				"Confirm the archive is CC0 on its page, set archiveUrl to the exact .zip,",
			);
			log(
				"then run e.g. `bun run library:producer-space -- <bulk-source-id>`.",
			);
			return { ingested: 0, sources: 0 };
		}

		const { acquireBulkSource } = await import("./acquire/bulk.mjs");
		const sources = resolveBulkSources(bulk, BULK_SOURCES);
		if (sources.length === 0) {
			throw new Error(
				`no bulk source matches "${bulk}". Run --list-bulk to see the declared bulk sources.`,
			);
		}
		let total = 0;
		for (const source of sources) {
			log(`\n== ${source.name} ==`);
			const result = await acquireBulkSource(source, {
				acquiredDir: ACQUIRED_DIR,
				evidenceDir: EVIDENCE_DIR,
				now: timestamp,
				log,
			});
			total += result.ingested;
			log(
				`evidence:  ${join(EVIDENCE_DIR, result.evidencePath.split("/").pop())}`,
			);
			log(`assets:    ${result.bundleDir}`);
		}
		log("");
		log(`ingested ${total} assets from ${sources.length} bulk source(s).`);
		log("Run `bun run library:build` to merge them into the manifest.");
		return { ingested: total, sources: sources.length };
	}

	if (vcsl) {
		// VCSL is a trusted bulk CC0 source, not a lockfile source: it does not
		// pin per file, it clones the repo, ingests a curated subset, and deletes
		// the clone. See acquire/vcsl.mjs.
		const { acquireVcsl } = await import("./acquire/vcsl.mjs");
		const result = await acquireVcsl({
			acquiredDir: ACQUIRED_DIR,
			evidenceDir: EVIDENCE_DIR,
			now: timestamp,
			log,
		});
		log("");
		log(
			`ingested ${result.ingested} VCSL assets at commit ${result.commit.slice(0, 12)}`,
		);
		log(`evidence:  ${join(EVIDENCE_DIR, "vcsl.md")}`);
		log(`assets:    ${result.bundleDir}`);
		log("");
		log("Run `bun run library:build` to merge them into the manifest.");
		return { ingested: result.ingested, sources: 1 };
	}

	let lockfile = readLockfile();
	if (only) {
		lockfile = {
			...lockfile,
			selections: lockfile.selections.filter(
				(selection) => selection.sourceId === only || selection.id === only,
			),
		};
	}

	if (plan) {
		reportPlan(lockfile, log);
		return { ingested: 0, sources: 0 };
	}

	if (pin) {
		const updated = await pinSelections(lockfile, { log, now: timestamp });
		writeLockfile(updated, { updatedAt: timestamp });
		log("");
		log(`wrote ${updated.selections.length} pins to ${LOCKFILE_PATH}`);
		log("Review every changed checksum before committing.");
		return { ingested: 0, sources: 0 };
	}

	// Rights and completeness are checked before a single byte is fetched.
	const errors = validateLockfile(lockfile);
	if (errors.length > 0) {
		throw new Error(
			`sources.lock.json is not shippable:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
		);
	}

	if (lockfile.selections.length === 0) {
		log("No selections pinned; nothing to acquire.");
		log("The synthesized library is unaffected — run `bun run library:build`.");
		return { ingested: 0, sources: 0 };
	}

	const evidence = await captureAllEvidence(lockfile, {
		evidenceDir: EVIDENCE_DIR,
		now: timestamp,
	});
	for (const [sourceId, record] of Object.entries(evidence)) {
		if (record.status !== "captured") {
			// The licence statement is the evidence. Ingesting without it would
			// produce assets whose rights record points at a capture that failed.
			throw new Error(
				`could not capture the licence statement for ${sourceId} (${findSource(sourceId)?.licenseUrl}). ` +
					"Rights evidence is required before ingest (section 3.4).",
			);
		}
	}

	const ingested = await ingestAll(lockfile, {
		quarantineDir: QUARANTINE_DIR,
		evidencePathFor: (source) => evidence[source.id].evidencePath,
	});

	// The lockfile ingest owns its own bundle directory so the VCSL bulk ingest
	// (a separate source) does not overwrite it — both are merged at build time.
	writeAcquiredBundle(join(ACQUIRED_DIR, "lockfile"), ingested);

	log("");
	log(
		`ingested ${ingested.length} assets from ${Object.keys(evidence).length} sources`,
	);
	log(`evidence:  ${EVIDENCE_DIR}`);
	log(`assets:    ${ACQUIRED_DIR}`);
	log("");
	log(
		"Run `bun run library:build` to merge them into the manifest, then `library:upload`.",
	);
	return { ingested: ingested.length, sources: Object.keys(evidence).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await acquire(parseArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
